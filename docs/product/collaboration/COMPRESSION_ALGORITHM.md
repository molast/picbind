# PicBind 当前图片压缩算法说明

本文档描述当前仓库中实际运行的图片压缩流程。它以代码实现为准，覆盖浏览器任务调度、PCE（PicBind Compression Engine）、Desktop Native 固定格式编码、各目标格式编码器、感知质量护栏、压缩增益 `K`、失败回退与内存生命周期。

## 1. 设计目标

当前压缩链路遵循以下原则：

1. 压缩在本地设备执行；Web 使用浏览器 Worker，Desktop 已启用的固定格式路径使用 Native Rust，原图不会因为压缩而上传到服务端。
2. PCE 先分析图像内容并预测各格式结果，再生成格式相关的压缩计划，而不是对所有图片使用同一组质量参数。
3. 同格式压缩必须满足“结果更小”；否则返回原图，避免出现压缩后体积反而增大。
4. 通过感知指标保护结构、边缘、颜色、亮度和 Alpha，不只比较文件大小。
5. `K` 只调整压缩幅度，不改变特征权重、图片分类、编码器和性能参数。
6. JPEG、PNG、WebP、AVIF，以及 Desktop Native 专用的 JPEG XL，使用各自更适合的编码路径。

## 2. 总体调用链

```text
选择图片
  |
  |-- 文件类型校验
  |-- 单文件大小校验（最大 5 MiB）
  |-- 立即加入 UI 队列
  |-- 本地持久化异步执行，不阻塞压缩
  v
ImageProcessingService
  |-- 首页使用 planner profile
  |-- Room / Workspace 使用 interactive profile
  |-- Web Adapter 选择对应的既有 Worker 链路
  v
压缩调度器
  |-- 全局最多同时执行 2 个任务
  |-- AVIF 最多同时执行 1 个
  |-- WebP 最多同时执行 2 个
  v
独立 Web Worker
  v
PCE 前端入口
  |-- 用户指定格式 -> 直接使用指定目标格式
  |-- 用户未指定格式 -> Compression Predictor 自动推荐目标格式
  |-- 提取源格式、目标格式、源文件大小和 Alpha 策略
  |-- 判断同格式/跨格式
  |-- 读取目标格式对应的 Compression Gain（K）
  |-- 选择编码器和质量评价器
  v
目标格式编码器
  |-- JPEG -> MozJPEG WASM
  |-- PNG  -> imagequant + lodepng + Oxipng WASM
  |-- WebP -> libwebp WASM（@jsquash/webp）
  |-- AVIF -> libavif + libaom WASM
  v
候选图质量护栏
  |-- 内建 PCE 感知指标
  |-- 可选 Butteraugli（当前只用于 JPEG/PNG 外层校验）
  v
结果选择
  |-- 同格式且结果不小于原图 -> 返回原图
  |-- 候选有效且符合策略 -> 返回压缩结果
  |-- 编码失败 -> 尝试格式对应的回退路径
  v
传回主线程并释放 Worker
```

React UI 现在通过 `ImageProcessingService` 发起压缩，不直接导入压缩 Worker。Web Adapter
按请求中的 profile 选择既有实现：首页使用 `planner`，Room / Workspace 使用
`interactive`。Tauri Desktop 对 JPEG、PNG、WebP、AVIF、JPEG XL 的固定目标和 `auto` 且不改变
尺寸的请求使用 Native Adapter：`interactive` 支持单次编码和目标尺寸缩放；`planner` 只对
同格式 JPEG、PNG 和 AVIF 执行有界质量候选与 Native 质量护栏，WebP 和所有跨格式输出使用
单候选快速路径，JPEG XL 始终使用无损单候选。`planner` 按现有契约不接受目标尺寸。Desktop 的参数预览、物化、
协作派生资源和完整质量对比也使用 Native Adapter；包含未支持操作或未覆盖字形的参数文档
整体调用 Web Adapter，结果中的 `engine` 保持真实值。

Web 路径的每个压缩任务创建一个独立 Worker。任务完成、失败、取消或向 Worker 发送任务失败后，该任务自己的 Worker 会被终止，因此 WASM 线性内存、解码后的像素缓冲和编码过程中的临时对象会随 Worker 一起释放。`AbortSignal` 现在由 Service 上下文传入首页 Worker 包装器；取消时会移除待处理任务、解绑监听器并立即终止对应 Worker。Native 路径由 Tauri `spawn_blocking` 执行，并为每个 `requestId` 注册取消标记；来源解析、解码和缩放边界、Planner 候选、参数操作、派生资源、质量分析主阶段、编码、临时文件持久化及结果交付之间均检查该标记。第三方编码器内部不能被强制中断，但取消后的结果不会继续持久化或交付。Desktop 使用持久路由栈保持压缩页面挂载；切换到 Favicon 或 Workspace 时不会终止正在运行的压缩任务，返回压缩页面后沿用原有队列和结果状态。

## 3. PCE 分层

### 3.1 Feature Extractor

WASM 解码图片后提取以下实际特征：

- 宽、高、像素总数、源文件大小和源格式。
- 是否声明 Alpha 通道，以及是否存在真实透明像素。
- Alpha 最小值、最大值、完全透明/半透明/非透明像素比例。
- 边缘强度。
- 亮度方差。
- 颜色复杂度和颜色熵。
- 噪声水平。
- 渐变区域、细节区域和平坦区域占比。

大部分图像内容特征使用采样扫描。采样步长为：

```text
stride = max(max(width, height) / 320, 1)
```

真实 Alpha 的判定使用短路扫描：

```rust
pixels.iter().skip(3).step_by(4).any(|alpha| *alpha < 255)
```

找到第一个小于 `255` 的 Alpha 值就立即结束，不会为了判断透明性继续扫描全部像素。只有确实存在透明像素时，才继续统计完整的 Alpha 分布。

当前 Feature Extractor 尚未解析 ICC、EXIF 或原始 JPEG 量化表，这些属于后续扩展能力，不参与当前压缩计划。JPEG 同格式编码路径会单独读取 SOF 标记中的色度采样信息，但不会将其作为通用图片特征。

### 3.2 Image Analyzer

Analyzer 将客观特征组合成两个综合值：

```text
complexity_score =
    0.24 * edge_strength
  + 0.14 * brightness_variance
  + 0.12 * color_complexity
  + 0.16 * color_entropy
  + 0.15 * detail_coverage
  + 0.13 * noise_level
  + 0.06 * gradient_coverage
  - 0.12 * flat_coverage

compressibility_score =
    0.30 * flat_coverage
  + 0.10 * gradient_coverage
  + 0.20 * (1 - complexity_score)
  + 0.14 * (1 - detail_coverage)
  + 0.08 * (1 - color_entropy)
  + 0.10 * (1 - alpha_ratio)
  + 0.08 * size_pressure
```

两项结果都限制在 `0..1`。Analyzer 不输出“照片、UI、漫画”等固定类型，而是让 Predictor 和 Planner 直接基于连续特征决策。

### 3.3 Compression Predictor

Predictor 位于 Analyzer 与 Planner 之间：

```text
Image Feature Analyzer
          |
          v
Compression Predictor
          |
          v
Compression Planner
```

它使用图片像素量、源文件大小、复杂度、细节、噪声、颜色熵、渐变、平坦区域和真实 Alpha，分别预测 JPEG、WebP、AVIF、PNG 的：

- 预计压缩后字节数。
- 预计视觉质量（`0..100`）。
- 当前格式是否可用。
- 综合大小和质量后的推荐格式。
- 是否值得从源编码器切换到推荐编码器。

当前 Predictor 是可解释的确定性启发式模型，不是经过训练的机器学习模型。预计大小以按格式建立的 bytes-per-pixel 模型计算；预计质量按格式对边缘、渐变、细节、平坦区域和颜色熵的敏感程度计算。

格式决策还包含以下规则：

- 存在真实 Alpha 时，自动决策中的 JPEG 标记为不可用，不会静默压平透明区域。
- 照片型连续特征会给 AVIF 更高的编码效率权重。
- 平坦、低熵、低噪声图片会提高 PNG 的权重。
- 含 Alpha 的图片会提高 WebP 的权重；边缘密集的透明图片会对 AVIF 更保守。
- 只有推荐格式相对源格式的预计结果至少节省约 `10%`，并且预计视觉质量下降不超过 `2.5` 分时，才判定“值得切换编码器”。否则继续使用源格式。

首页格式语义：

- 用户没有主动选择任何格式：创建一个 `AUTO` 任务，Worker 先运行 Predictor，再把推荐格式交给 Planner。
- 用户主动选择一个格式：跳过 Predictor，强制使用该格式。
- 用户主动选择多个格式：为每个选中格式分别创建任务，每个任务都跳过 Predictor。
- Predictor 解码或调用失败：回退到源格式，不能阻断压缩。
- 自动任务在调度器中保守占用 AVIF 单并发槽位，避免多个任务同时被推荐为 AVIF 后造成内存峰值。

普通 JPEG/PNG/WebP 直接通过 WASM 解码和预测。由于 Rust `image` 解码路径不负责 AVIF，AVIF 会先由浏览器解码成 RGBA，再调用 `predict_compression_rgba`，两条路径最后使用同一个 Predictor。

预测值只用于编码决策，不会作为最终压缩结果展示或替代实际文件大小；最终结果仍由编码器和质量护栏决定。

### 3.4 Compression Planner

Planner 根据目标格式和分析结果生成：

- 质量候选列表。
- PNG 调色板颜色候选和抖动强度。
- AVIF 编码质量、色度采样、速度、分块和 Alpha 质量下限。
- 各类感知质量护栏阈值。

同一张图片转成不同格式会获得不同计划；同一格式的不同图片也可能获得不同候选参数。

### 3.5 Compression Gain

Gain 位于 Planner 和 Encoder 之间。四个目标格式分别读取：

```env
NEXT_PUBLIC_PCE_JPEG_K=1.0
NEXT_PUBLIC_PCE_PNG_K=1.0
NEXT_PUBLIC_PCE_WEBP_K=1.0
NEXT_PUBLIC_PCE_AVIF_K=1.0
```

合法范围为 `0.5..2.0`，无效值回退为 `1.0`：

- `K = 1.0`：严格保持标准计划。
- `K > 1.0`：逐步增强压缩幅度，允许更多感知误差。
- `K < 1.0`：逐步减弱压缩幅度，质量更保守。

调整公式：

```text
quality'       = 100 - (100 - quality) * K
max_error'     = max_error * K
min_similarity'= 1 - (1 - min_similarity) * K
palette_colors'= palette_colors / sqrt(K)
```

所有结果仍会被各自安全范围钳制。例如调色板限制为 `16..256` 色，AVIF 有损质量下限为 `24`，Alpha 质量下限不会低于 `50`。

`K` 的输入变化是连续且单调的，但最终文件大小不保证数学上的线性变化。原因是质量值需要取整、PNG 调色板颜色数是离散值、编码器内部决策也是分段的，并且候选可能跨过或未跨过质量护栏。

## 4. 编码器选择矩阵

| 目标格式 | 主编码器 | 主要策略 | 感知校验 |
|---|---|---|---|
| JPEG | `mozjpeg-rs` / MozJPEG WASM | 自适应质量、渐进式、色度采样、Huffman 优化 | PCE 内建护栏；可选 Butteraugli |
| PNG | `imagequant` + `lodepng` + `oxipng` WASM | 感知量化、索引色、Alpha 调色板、按内容抖动、无损后优化 | PCE 内建护栏；可选 Butteraugli |
| WebP | `@jsquash/webp` / libwebp WASM | 有损 WebP、Sharp YUV、Alpha 单独高质量保存 | PCE 内建护栏，不走 Butteraugli |
| AVIF | libavif + libaom WASM | 自适应质量候选、色度采样、分块和 Alpha 质量保护 | PCE 内建护栏，不走 Butteraugli |

Desktop Native 固定目标格式使用另一套平台专用 codec：

| 目标格式 | Native 编码器 | 当前行为 |
|---|---|---|
| JPEG | `mozjpeg-rs` | `JpegEncoderOptions` 默认使用 `ProgressiveBalanced`、Progressive、Huffman 优化，并按质量选择 4:4:4 / 4:2:2 / 4:2:0；透明源默认拒绝，明确允许后与白色合成 |
| PNG | `imagequant + lodepng + oxipng` | `PngEncoderOptions` 默认使用 256 色、imagequant speed 5、无抖动和 OxiPNG preset 1；`interactive` 在调色板与无损 RGBA 结果中选择较小者；`planner` 不重复生成无损候选 |
| WebP | `zenwebp` | `WebPEncoderOptions` 默认使用有损 RGBA、method 5、Alpha quality 100 |
| AVIF | `ravif 0.13 / rav1e` | `AvifEncoderOptions` 默认使用 speed 9、8-bit YCbCr、主质量同步 Alpha 质量、`UnassociatedClean` 和 Rayon 默认线程池；跨格式单候选；同格式按质量升序搜索并使用 `zenavif` 回读 |
| JPEG XL | `zune-jpegxl 0.5.2` | `JpegXlEncoderOptions` 默认 effort 4、4 个 scoped worker threads、8-bit RGB/RGBA、去除元数据；当前只编码静态无损 JXL codestream，完整保留 Alpha |

Native 解码先根据 magic bytes 识别 JPEG、PNG、WebP、AVIF 或 JPEG XL。JPEG 使用
`zune-jpeg 0.5.15` 解码为 RGB8；PNG 使用 `zune-png 0.5.2`，保留 Luma、LumaA、RGB、RGBA
布局与调色板透明度，并把 16-bit 输入规范到当前 Native 的 8-bit 像素模型。两者默认启用
平台 SIMD/unsafe 快速路径，同时保留严格格式校验、16384 单边限制和可扩展 decoder Options。
PNG 当前只解码首帧。WebP 直接使用 `image-webp 0.2.4` 解码，无 Alpha 输入输出 RGB8，含
Alpha 输入输出 RGBA8；`WebPDecoderOptions` 默认使用 Bilinear 有损色度上采样和
400,000,000 bytes 内存上限，在分配像素缓冲前执行 16384 单边与 100,000,000 总像素检查，
动画 WebP 当前只读取首帧。JPEG XL 同时识别 `FF 0A` codestream 与 12-byte container
signature，并使用 `jxl-oxide 0.12.6` 解码。所有格式随后进入统一 `DynamicImage` 像素模型，
因此五种输入都可以输出五种目标格式，实际覆盖 5×5 共 25 条编解码路径。Native 固定格式压缩仍
遵守同格式不增大和默认 Alpha 保护；跨格式转换使用 `forceEncode`，不套用返回源文件规则。
Native `auto` Predictor 对解码后的 RGBA 进行有界采样，提取真实 Alpha、颜色熵、细节覆盖和
平坦区域覆盖：平坦低熵图优先 PNG，透明细节图优先 WebP，其他透明图和高细节不透明图优先
AVIF，其余使用 WebP。透明图永远不会自动选择 JPEG，Auto 当前也不会选择 JPEG XL；生成
JPEG XL 必须显式指定目标格式。Desktop 首页格式选择器提供 JXL，选择后通过 Native
`planner` 生成 `.jxl` 结果；Web 首页仍只展示 JPEG、PNG、WebP、AVIF。

Native `planner` 按 `dev_dioxus` 的格式专用纯 Rust 路径执行。WebP、JPEG XL，以及源格式与目标格式不同的
JPEG、PNG、WebP、AVIF 请求只编码一次，不做候选回读。JPEG XL 当前是无损编码，公开请求中的
`quality` 与 Compression Gain 不改变其码流参数。只有
`JPEG -> JPEG`、`PNG -> PNG` 和 `AVIF -> AVIF` 围绕有效质量生成 `-8 / 0 / +8` 三档升序去重
候选；PNG 最低质量为 50，JPEG/AVIF 最低质量为 45。每个候选编码、回读并通过护栏后立即
返回，不再为了寻找最小文件无条件执行剩余候选。单个候选编码或解码失败时继续下一档，取消
错误会立即向上传播。PNG Planner 候选只执行 imagequant/lodepng 和一次 Oxipng preset 1，
不会在每一档重复生成、优化无损 RGBA PNG。候选循环外复用已解码的 RGBA/RGB 缓冲；Alpha
扫描、Auto Predictor 和质量比较遇到现成 RGBA8 时直接借用，不复制整张图片。PNG 量化也
通过 `rgb::FromSlice` 将同一块交错 RGBA 缓冲借给 imagequant，不再为每个像素重建一份
`imagequant::RGBA` 向量。

Native 五种 codec 都按 `decoder/`、`encoder/` 分层。JPEG、PNG、WebP、AVIF、JPEG XL 编码参数分别由
`JpegEncoderOptions`、`PngEncoderOptions`、`WebPEncoderOptions`、`AvifEncoderOptions`、
`JpegXlEncoderOptions` 承载；JPEG、PNG、WebP、AVIF、JPEG XL 解码参数分别由
`JpegDecoderOptions`、`PngDecoderOptions`、`WebPDecoderOptions`、`AvifDecoderOptions`、
`JpegXlDecoderOptions` 承载。默认 `decode` / `encode` / `encode_rgb` / `encode_rgba` 入口
只是构造默认 Options 的兼容包装。这些 Options 当前属于 Native codec 内部扩展点，不是
API V1 新增的公开压缩配置。各格式算法和参数矩阵记录在
`crates/picbind-image-native/src/codecs/README.md`。

AVIF 编解码按 `decoder/`、`encoder/` 拆分，并由 `AvifDecoderOptions`、`AvifEncoderOptions`
集中管理可扩展参数。编码默认使用 speed 9、8-bit YCbCr、主质量同步 Alpha 质量、
`UnassociatedClean` 和 `ravif` 全局 Rayon 线程池；解码使用 `zenavif` 并将高位深输入规范为
RGBA8。当前 `zenavif 0.1.6 / rav1d-safe 0.5.7` 在 macOS ARM 自动线程模式下存在
tile threading panic，因此 `AvifDecoderOptions` 默认固定为 1 个解码线程；该限制不影响
`ravif` 编码线程。编码结果 metadata 直接使用已知尺寸、格式和 Alpha 状态，不额外解码刚
生成的 AVIF；只有同格式候选需要 `zenavif` 回读。Native 质量比较最多均匀采样
16 万像素，计算全局亮度 SSIM、RGB PSNR、相邻像素梯度能量保留率、Alpha 平均误差和 P95
误差。当前同格式候选阈值如下：

JPEG XL 编解码也按 `decoder/`、`encoder/` 拆分。`JpegXlDecoderOptions` 管理可选的 Rayon
线程数，默认使用全局 Rayon 池；`JpegXlEncoderOptions` 管理 effort、线程数和位深，当前只
接受 8-bit RGB/RGBA。编码使用 `zune-core 0.5.3` 的 `EncoderOptions` 和
`zune-jpegxl 0.5.2` 的 `JxlSimpleEncoder`，解码使用启用 image/Rayon 集成的
`jxl-oxide 0.12.6`。当前仅保证静态图片路径：Encoder 只生成单帧无损 codestream，Decoder
集成不提供动画输出。JXL 单候选是逐像素无损结果，因此不进入有损候选质量阈值表；同格式
结果不小于原 JXL 时仍由统一 Engine 返回原文件。编码响应的 metadata 直接使用已知尺寸、
格式和 Alpha 状态构造，不会为了 metadata 额外回读刚生成的 JXL。

| 格式 | 最低 SSIM | 最低 PSNR | 最低边缘保留率 | Alpha 护栏 |
|---|---:|---:|---:|---|
| JPEG | 0.955 | 28.0 dB | 0.72 | 透明输入仍由显式 Alpha loss 规则控制 |
| PNG | 0.985 | 32.0 dB | 0.86 | 平均误差 <= 0.1，P95 <= 1 |
| AVIF（同格式） | 0.955 | 22.5 dB | 0.72 | 平均误差 <= 1，P95 <= 3 |

Native 护栏是平台专用的轻量实现，不包含 Web PCE 的 MS-SSIM、Delta E 或 Butteraugli，不能
把两端描述成字节级或指标实现完全一致；两端共同保证格式、尺寸、Alpha 和产品回退语义。

Desktop Native `interactive` 收到目标尺寸时，在统一 RGBA 解码后使用 Rust `image` 的
`Lanczos3` 精确缩放，再执行固定格式或 Auto Predictor 编码。目标宽高必须分别处于
`1..=16384`，且总像素不能超过 `100,000,000`；校验在目标缓冲分配前执行。目标尺寸等于源图
尺寸时视为未缩放，继续应用同格式不增大规则；目标尺寸发生变化时禁止返回原文件，否则会把
原始宽高错误地伪装成缩放结果。Native Auto Predictor 使用缩放后的像素特征选择格式。

Desktop Native Core 现已实现 `ImageParameterDocument` V1 的有序参数重放。源文件只解码
一次，crop、resize、rotate、color 和 draw 依次作用于同一个 RGBA 容器，不为中间步骤
创建编码文件。Color 顺序与 Web 编辑器保持一致并保留 Alpha；draw 支持线、箭头、矩形、
椭圆、自由笔迹、缩放、旋转、线型、填充、内嵌 Noto Sans 文字和固定 Twemoji 彩色 Emoji。
文字与 Emoji 不读取操作系统字体，保证 Desktop 平台间使用相同资源。文档版本、操作数量、唯一 ID、嵌套
深度、集合大小、有限数值、尺寸和颜色范围均在 Rust 边界重新校验。异常画布外坐标先裁剪到
实际图像范围。

`renderPreview()` 先计算有序参数队列的最终几何尺寸，再按请求边界统一缩小源缓冲以及
resize/draw 的绝对坐标；归一化 crop 与操作顺序不变，最终只编码一个受限 WebP且不放大；
`materialize()` 在完整分辨率重放并只在最终输出编码一次。空参数文档且输出格式为源格式时可
直接返回原文件，存在任意操作时不得返回原文件。`filter`、`annotation`、`ai`、内嵌字体未覆盖
的字符或未知 Emoji 会返回明确的 unsupported operation，Adapter 对完整文档使用 Web fallback，
不能静默忽略或混合两端渲染。参数重放本身不改变压缩候选和同格式不增大规则。

Native `createShareAssets()` 对同一个解码/参数重放结果分别生成两类派生资源：placeholder
包含原渲染尺寸、线性 RGB 主色和 4×3 BlurHash；thumbnail 独立按容器等比缩小、不放大并
编码为 WebP。thumbnail 不会写入 `blurHash` 字段，也不能代替颜色 Hash。Native
`compareQuality()` 接收两个独立二进制输入，计算完整 source/assessed 特征、MSE、RMSE、
PSNR、SSIM、MS-SSIM、边缘保留、拉普拉斯方差、Delta E 分位数、亮度/色度误差、感知距离和
Alpha 误差。完全一致图片的 PSNR 在 JSON IPC 中报告为 100 dB 上限，避免非有限数值无法
序列化；其 MSE、Delta E 和 Alpha 误差仍为 0，SSIM/MS-SSIM 为 1。质量像素运算和完整特征
提取使用最长边 1600 的等比采样图，结果中的宽高和文件大小仍记录原输入；这避免最大尺寸
图片为多个指标向量分配数 GB 内存。

## 5. JPEG 流程

### 5.1 Alpha 规则

JPEG 不支持 Alpha：

- 源图不含真实透明像素时，可以正常编码为 JPEG。
- 源图包含透明像素且未允许丢失 Alpha 时，拒绝 JPEG 输出。
- 明确允许丢失 Alpha 时，先将透明区域与白色背景合成，再编码 JPEG。
- JPEG 源图天然按 RGB 处理，不创建无意义的 Alpha 输出。

### 5.2 JPEG 转 JPEG

1. 提取细节、边缘、渐变、平坦区域、噪声、文件大小和像素量。
2. 以请求质量为基线，生成一组自适应质量候选。除常规候选外，还包含最低不低于 `45` 的深度压缩候选，用于已经压缩过、体积很小但仍存在安全压缩空间的 JPEG；该候选仍必须通过同一套感知护栏。
3. 高细节、高边缘、高渐变图片提高质量；平坦、易压缩、大文件或高噪声图片允许降低质量。
4. 候选按“更可能得到小文件”的方向开始尝试。
5. 从原 JPEG 的 SOF 标记读取色度采样，并在重新编码时保留 4:4:4、4:2:2、4:2:0 或 4:4:0，避免 UI、动漫和高色彩边缘图片被无条件降为 4:2:0。
6. MozJPEG 编码后，候选必须小于原文件。
7. 解码候选，并执行 PCE 感知质量护栏。默认 JPEG 同格式护栏以 `MS-SSIM >= 0.990` 为结构质量底线，并按内容类型限制模糊、综合色差、亮度和色度误差。
8. 返回第一个满足护栏的较小候选；没有候选满足时进入外层回退/原图策略。

MozJPEG 固定启用：

- `ProgressiveBalanced` 渐进式预设。
- Progressive JPEG。
- Huffman 表优化。
- JPEG 同格式压缩保留源文件色度采样。
- 其他格式转 JPEG 时，质量 `>= 96` 使用 4:4:4，`90..95` 使用 4:2:2，更低质量使用 4:2:0。

### 5.3 其他格式转 JPEG

- PNG 转 JPEG 使用基于内容和体积的质量候选，标准计划最低质量为 `80`；Gain 作用后仍有额外安全下限。
- 其他跨格式路径按请求质量编码；若外层 Butteraugli 开启，可用更高质量候选重试。
- WASM JPEG 编码出现内存、格式支持或编码器错误时，浏览器使用 `OffscreenCanvas` JPEG 作为回退。

Desktop Native Planner 的跨格式 JPEG 使用 Gain 调整后的请求质量编码一次；`JPEG -> JPEG`
才按升序质量候选执行 Native SSIM、PSNR、边缘与 Alpha 护栏，并复用一次准备好的 RGB 缓冲。
Native `JpegEncoderOptions` 还允许 codec 内部显式覆盖 preset、Progressive、Huffman、色度采样
和 Alpha 合成背景；默认值保持上述现有策略。

## 6. PNG 流程

PNG 的核心不是简单 Deflate，而是“感知量化为索引色 + 无损后优化”。

### 6.1 PNG 转 PNG

1. PCE 判断图片是否偏向平滑渐变、颜色丰富、边缘密集或普通内容。
2. 标准调色板候选为 `64 / 128 / 192 / 256` 色，Gain 会统一缩放颜色预算。
3. 根据内容选择抖动强度：
   - 平滑渐变：`0.75`。
   - 颜色丰富：`0.75`。
   - 边缘密集：`0.0`，避免文字和硬边出现噪点。
   - 普通内容：`0.55`。
4. imagequant 对 RGBA 像素进行感知颜色量化，生成 Palette 和索引像素。
5. lodepng 以 8-bit indexed PNG（颜色类型 3）写出结果，并使用 `MINSUM` 过滤和 Deflate level 9。
6. 候选必须比原 PNG 小。
7. 解码候选，校验结构、颜色、亮度、色度和 Alpha 误差。
8. 返回第一个通过护栏的候选。
9. 最后交给 Oxipng 做无损优化；只有更小时才采用优化结果。

### 6.2 跨格式转 PNG

- AVIF 由浏览器 `createImageBitmap` 解码为 RGBA，再直接交给 WASM PNG 路径，避免 Rust `image` 解码器不支持 AVIF 时退化为普通 Canvas RGBA PNG。
- JPEG 等不透明源图会被识别为无真实 Alpha；量化时按 RGB 语义处理。
- 超过 800 万像素时，先将图像缩放采样到最多约 100 万像素来训练调色板，再使用缓存的颜色桶把原尺寸像素映射到 Palette，以控制浏览器内存和耗时。
- 跨格式候选若保守护栏没有命中，仍会保留 imagequant 质量约束下的 256 色候选，保证格式转换可用。

### 6.3 Oxipng

Oxipng 只做无损后处理：

- 普通图片使用 preset 3。
- 超过 800 万像素使用较轻的 preset 1。
- 上述两档是 Web/WASM 行为；Desktop Native 固定使用 preset 1，并设置 `force=true`，避免
  小于 800 万像素的本地图片重新进入高耗时 preset 3 搜索。
- 优化失败或结果不更小时，保留优化前 PNG。

当前主 PNG 管线没有使用 Zopfli。代码保留了 lodepng Deflate 编码入口，但 PCE 的量化 PNG 路径使用 imagequant、lodepng 和 Oxipng。

Desktop Native Planner 的跨格式 PNG 使用单个量化候选；`PNG -> PNG` 才按升序质量候选回读
并在首个通过 Native 护栏时停止。同格式最终候选不小于源文件或全部候选失败时，由统一规则
返回原 PNG，因此 Planner 不需要为每档额外生成无损候选。`interactive` 仍会在单次调用内
比较量化结果与无损 RGBA 结果。`PngEncoderOptions` 承载量化开关、是否比较无损候选、质量、
调色板颜色数、imagequant speed、抖动强度和完整 `oxipng::Options`；默认量化输入直接借用
现有 RGBA 缓冲，不分配第二份逐像素颜色数组。

## 7. WebP 流程

1. 浏览器使用 `createImageBitmap + OffscreenCanvas` 解码为 `ImageData`。
2. 根据是否为 WebP 同格式压缩，生成两档质量候选。
3. Gain 调整候选质量。
4. libwebp 使用以下关键设置编码：
   - 有损模式。
   - `method = 4`。
   - `pass = 1`。
   - `use_sharp_yuv = 1`。
   - `alpha_quality = 100`。
   - 启用 Alpha 压缩、Alpha 过滤和自动过滤。
5. 对能被质量模块解码的源图，计算 PCE 感知指标。
6. 优先从通过护栏的候选中选择最小文件；没有候选通过时，从成功编码的候选中选择最小文件。
7. WebP 转 WebP 若结果不小于原图，直接返回原图。
8. 某个质量候选失败不会使整个 WebP 任务失败，其他候选仍会继续执行。

当前 WebP 不启用 Butteraugli 外层校验，避免额外解码和多轮编码造成明显耗时。

Desktop Native WebP 由 `WebPEncoderOptions` 配置 `zenwebp` 的质量、method 和 Alpha quality，
默认值为 method 5、Alpha quality 100；`interactive` 与 `planner` 都只编码一次，同格式结果
不更小时仍由统一规则返回原 WebP。Native WebP 回读与普通输入解码均直接使用
`image-webp 0.2.4`；`WebPDecoderOptions` 可配置内存上限和 Bilinear/Simple 有损色度上采样，
默认使用 Bilinear，并按文件 Alpha 状态保留 RGB8 或 RGBA8。

## 8. AVIF 流程

Web PCE 路径：

1. 浏览器解码源图为 RGBA。
2. WASM Feature Extractor 和 Planner 基于 RGBA 生成 `AvifEncodingPlan`。
3. Plan 包含质量候选、编码速度、位深、色度采样、Sharp YUV、分块、Alpha 质量下限和感知阈值。
4. libavif 调用 libaom 编码各候选。
   Web 环境通过 `Cross-Origin-Opener-Policy: same-origin` 和
   `Cross-Origin-Embedder-Policy: credentialless` 建立跨域隔离，在浏览器同时支持
   `crossOriginIsolated` 与 `SharedArrayBuffer` 时允许使用多线程编码器；不支持
   `credentialless` 或共享内存时自动使用单线程编码器。`credentialless` 会让普通
   跨域资源请求不携带凭据，因此头像等仅用于展示的第三方图片不需要提供 CORP
   响应头。Desktop 上只有回退到 Web Adapter 的 `auto`、resize 等请求会经过此路径，
   并固定使用单线程 WASM，避免 macOS WKWebView 在压缩 Worker 内创建 pthread 子 Worker。
5. 无真实 Alpha 时设置 `qualityAlpha = -1`，不创建无意义的 Alpha 编码负担；存在真实 Alpha 时使用 `max(candidateQuality, alphaQualityFloor)`。
6. 将候选 AVIF 再解码为 RGBA，使用 PCE 指标与原图比较。
7. 第一个通过护栏的候选直接返回。
8. 超过 1200 万像素时，只尝试最多两个非 100 质量候选，控制耗时和内存。

Desktop Native `interactive` AVIF 请求不经过上述 Web PCE 多候选流程：Tauri 后台阻塞任务
使用 `ravif 0.13 / rav1e` speed 9 和默认 Rayon 线程池编码一次；`zenavif` 使用 1 个安全线程
处理 AVIF 输入和同格式候选的质量回读。编解码参数分别由 `AvifEncoderOptions` 和
`AvifDecoderOptions` 承载，编码结果的 metadata 由已知尺寸、格式和 Alpha 状态直接构造，
不额外解码刚生成的 AVIF。
`planner` 对非 AVIF 源使用相同的单候选快速路径；只有 `AVIF -> AVIF` 才生成三档升序候选，
逐个执行 Native 质量护栏并在首个候选通过时停止。AVIF 候选循环外只创建一次 RGBA 缓冲。
9. AVIF 转 AVIF 若候选不小于原图或编码失败，返回原图。
10. 跨格式转 AVIF 的单次编码失败时直接返回编码错误。

当前 AVIF 不启用 Butteraugli 外层校验，其质量由 PCE 内建指标和 libaom 编码计划控制。

## 9. 感知质量护栏

PCE 会把候选图解码后与原图对比。为控制大图成本，护栏比较时最长边最多缩放到 `1600` 像素。

当前指标包括：

- MSE、RMSE、PSNR。
- SSIM、MS-SSIM。
- Sobel 边缘能量保留率。
- Laplacian 方差和模糊损失百分比。
- 综合质量分。
- Delta E 均值、P95、P99，以及视觉掩蔽后的 Delta E。
- P95 亮度误差和色度误差。
- 综合人眼感知距离。
- Alpha 均值、P95 和 P99 误差。

不同格式不会使用完全相同的阈值：

- JPEG 重点保护 MS-SSIM、模糊、颜色、亮度和色度；同格式默认以 `0.990` 作为 MS-SSIM 最低线，其他误差阈值按内容类型变化。
- PNG 额外严格保护 Alpha，并按图片内容切换阈值和抖动。
- WebP 使用 SSIM、MS-SSIM、模糊损失和综合质量分。
- AVIF 同时校验结构、模糊、颜色、亮度、色度和 Alpha。

## 10. Butteraugli 可选校验

配置：

```env
NEXT_PUBLIC_BUTTERAUGLI_ENABLED=false
NEXT_PUBLIC_BUTTERAUGLI_TARGET_SCORE=1.0
```

启用后，当前仅对 JPEG 和 PNG 增加外层 Butteraugli 候选评价：

1. 从请求质量开始，最多尝试 `quality / quality+10 / quality+20`。
2. 每个候选解码为 RGBA。
3. 计算 Butteraugli overall score。
4. 分数小于等于目标值时接受候选。
5. 全部未达标时返回分数最接近目标的有效候选，而不是让任务完全失效。

目标分数会一起受到 Gain 影响：`effectiveTarget = target * K`。Butteraugli 默认关闭，因为多轮编码、候选解码和视觉比较会显著增加耗时。WebP 和 AVIF 明确跳过这层评价。

这些 `NEXT_PUBLIC_*` 环境变量由 Next.js 在构建时注入。修改本地配置后需要重启开发服务；生产配置变更需要重新构建。

## 11. 同格式不增大规则

统一规则为：

```text
if source_format == target_format
   and compressed_size >= original_size:
       return original
```

该规则应用于 JPEG、PNG、WebP 和 AVIF。跨格式转换不强制比源文件更小，因为用户可能明确需要另一种格式；但仍会尽量选择有效的小候选。

返回原图时会保留原文件名、MIME 和扩展名，不会把原始字节伪装成目标格式。

## 12. 错误与回退策略

| 场景 | 当前行为 |
|---|---|
| 同格式编码失败 | 返回原图，保证该格式任务可完成 |
| JPEG WASM 内存/编码/格式错误 | 尝试 OffscreenCanvas JPEG，多档质量向下搜索 |
| PNG WASM 内存/量化/格式错误 | 尝试 OffscreenCanvas PNG；同格式仍要求更小 |
| 单个 WebP 候选失败 | 忽略该候选并继续其他候选 |
| WebP 同格式无有效候选 | 返回原 WebP |
| AVIF 同格式无更小候选或失败 | 返回原 AVIF |
| AVIF 跨格式无任何有效候选 | 抛出明确错误，由 UI 标记该格式失败 |
| Native Planner 同格式 JPEG/PNG/AVIF 单个候选失败或未通过护栏 | 忽略该候选并继续下一档；取消错误立即返回 |
| Native Planner 同格式 JPEG/PNG/AVIF 无通过护栏的更小候选 | 返回原图 |
| Native Planner WebP 或跨格式单候选失败 | 抛出明确编码错误；同格式 WebP 失败时返回原图 |
| JPEG 目标遇到真实 Alpha 且不允许丢失 | 拒绝压缩，不静默破坏透明区域 |
| Room 中显式执行其他格式转 JPEG | 视为用户明确允许 JPEG 丢失 Alpha，先与白色背景合成再编码 |

回退路径的目标是保证可用性，但 Canvas 编码不具备主编码器相同的自适应控制，因此只在主路径不可用时使用。

## 13. 并发与内存生命周期

### 13.1 并发限制

- 总压缩并发：2。
- AVIF 并发：1。
- WebP 并发：2。
- 每个任务独立 Worker，避免编码阻塞主线程。
- Tauri 固定格式 AVIF 在 Rust `spawn_blocking` 任务中执行，单个任务内部由 `ravif` 默认
  Rayon 线程池编码；`zenavif` 解码因当前 `rav1d-safe` ARM tile threading panic 固定为 1
  线程，AVIF 任务级并发仍限制为 1。回退到 Web Adapter 的 AVIF 请求使用单线程 WASM。
  Web 站点在运行环境支持时仍可使用多线程 AVIF 编码器。
- Desktop Native resize 与后续编码位于同一个 `spawn_blocking` 任务；缩放后的 RGBA 缓冲在
  编码任务返回时释放，不通过 IPC 往返传输。
- Native 参数预览、物化、placeholder、thumbnail 和质量分析同样位于单个 `spawn_blocking`
  命令中；解码图、重放容器、缩放缓冲和指标向量在命令返回后释放。预览与派生资源继续
  返回有界内存结果；压缩、转换和物化选择 `temporary` destination 时，输出写入应用受控的
  `temp/image-processing`，`sync_all` 后同目录 rename，并只向 WebView 返回实例内 UUID
  token。token 默认 15 分钟过期，支持幂等释放；Storage 接管成功后 token 失效，接管失败
  时仍可重试或释放，应用重启会清理上个实例遗留文件。

AVIF 并发单独限制为 1，是因为 RGBA 解码、libaom 编码和候选回解码同时存在时内存峰值最高。

### 13.2 资源释放

- `ImageBitmap` 在 `finally` 中执行 `close()`。
- Worker 输出使用 transferable `ArrayBuffer` 传回主线程，避免额外复制。
- 每个任务完成、失败、取消或发送任务失败后立即 `worker.terminate()`，只释放该任务的 Worker。
- Desktop 的压缩、Favicon 和 Workspace 页面使用持久路由栈；站内切换只隐藏非当前页面，不卸载压缩页面，也不会批量终止活跃 Worker。
- Blob URL 在替换、删除或页面卸载时调用 `URL.revokeObjectURL()`。
- 原始 `File` 在该图片所有格式均不再处于 queued/processing 后，从 staged 内存缓存释放。
- Dexie / IndexedDB 负责关联数据和必要的文件队列元数据持久化，OPFS 负责图片文件；压缩算法不会把图片 Blob 存入 Dexie 表。

## 14. 当前边界

当前已实现的是稳定的 PCE 框架和格式专用编码链，而不是 TinyPNG/TinyJPG 服务端算法的完整复刻。以下能力尚未进入当前 Planner：

- ICC 色彩配置解析与色域感知决策。
- EXIF 内容分析和方向之外的元数据策略。
- 原 JPEG 量化表反推和精确源质量估算。
- 基于大规模图片训练的质量/QP 预测模型。
- 跨大量候选的全局体积-质量二分搜索。
- PNG Zopfli 深度搜索。

后续增加这些能力时，应继续沿用：

```text
Feature Extractor -> Analyzer -> Predictor -> Planner -> Gain -> Encoder -> Guardrail
```

编码器只执行 Plan，不应在编码器内部重新发明图片分类规则；Gain 只调整幅度，不应改变编码器 effort、并发或策略分支。

## 15. 关键实现位置

| 职责 | 文件 |
|---|---|
| 前端统一入口、格式编码和回退 | `apps/web/src/utils/compress-algorithms.ts` |
| 共享 WebP / AVIF 浏览器编码 SDK | `packages/wasm/image-codecs/src/index.ts` |
| PCE 前端 Plan、编码器选择和 Butteraugli 调度 | `apps/web/src/utils/compression-engine.ts` |
| Gain 环境变量和前端公式 | `apps/web/src/utils/compression-gain.ts` |
| Worker 生命周期 | `apps/web/src/utils/wasm-worker.ts`、`apps/web/src/workers/compress.worker.ts` |
| 跨平台图片处理 Port 与 Web Adapter | `packages/shared/src/image-processing/`、`apps/web/src/image-processing/` |
| 页面队列、并发和 5 MiB 限制 | `apps/web/src/components/home/use-home-compression.ts` |
| WASM Feature Extractor | `crates/picbind-image/src/core/feature.rs` |
| WASM Analyzer | `crates/picbind-image/src/core/analysis.rs` |
| WASM Predictor | `crates/picbind-image/src/core/predictor.rs` |
| Predictor 浏览器适配和 AVIF/RGBA 路径 | `apps/web/src/utils/compression-predictor.ts` |
| 格式 Planner 和阈值 | `crates/picbind-image/src/core/quality.rs` |
| Gain 公式 | `crates/picbind-image/src/core/gain.rs` |
| JPEG / MozJPEG | `crates/picbind-image/src/core/jpeg.rs` |
| PNG / imagequant / lodepng | `crates/picbind-image/src/core/png.rs` |
| PNG / Oxipng | `crates/picbind-image/src/core/png_oxipng.rs` |
| 感知指标 | `crates/picbind-image/src/core/metrics.rs`、`crates/picbind-image/src/core/hvs.rs` |
| WASM 目标格式调用链 | `crates/picbind-image/src/core/pipeline/to_format.rs` |
| Desktop Native 五格式 codec 与参数矩阵 | `crates/picbind-image-native/src/codecs/`、`crates/picbind-image-native/src/codecs/README.md` |
| Desktop Native Workspace 参数操作与重放（含 resize） | `crates/picbind-image-native/src/operations/` |
| Desktop Native 预览与物化 | `crates/picbind-image-native/src/render/` |
| Desktop Native placeholder / thumbnail | `crates/picbind-image-native/src/derived/` |
| Desktop Native 完整质量分析 | `crates/picbind-image-native/src/analysis/` |
| Desktop Native 取消控制 | `crates/picbind-image-native/src/task.rs` |
| Desktop Native 契约与实机验证 | `crates/picbind-image-native/tests/adapter_contract.rs`、`crates/picbind-image-native/examples/native_validation.rs` |
| Desktop Native Tauri binding | `apps/desktop/src-tauri/src/image_processing/` |
| Desktop Native / Web 能力路由 | `apps/web/src/image-processing/adapters/desktop-image-processing-selector.ts` |

## 16. Room Image Workspace 压缩入口

`packages/ui` 现在提供独立的图片版本压缩入口。它复用共享 `image-wasm`，但不等同于首页完整的 Worker/PCE 候选调度链：

1. `自动`模式调用 WASM `predict_compression`，从 JPEG、WebP、AVIF 中选择建议格式；PNG 源图在预测不可用时回退到 WebP，以避免自动选择 JPEG 后丢失透明度。用户也可以在 Room 压缩弹窗中显式选择 JPEG、PNG、WebP 或 AVIF；显式选择 PNG 时直接进入共享 WASM PNG 编码路径。
2. JPEG 和 PNG 编码调用共享 WASM。WASM 无法直接解码输入时，先由浏览器解码为 RGBA；PNG 调用 `compress_rgba_to_png_with_gain`，JPEG 仅在图片没有真实 Alpha 时使用 `OffscreenCanvas` 回退，透明图片会被明确拒绝而不会静默压平。
3. Web 与 Workspace 的 WebP、AVIF 浏览器编码统一通过 `packages/wasm/image-codecs` 提供的 `@picbind/image-codecs`。SDK 内部按格式拆分实现：WebP 适配层持有普通/SIMD WASM，统一执行 SIMD 能力检测、Emscripten 模块缓存、编码实例中止后的重建和 SIMD 失败后的普通 WASM 兜底；AVIF 适配层持有单线程/多线程 WASM 和线程 Worker 资源，并共享线程能力判断、模块缓存、大图分块参数、编码实例中止后的重建和多线程失败后的单线程兜底。Workspace 不再维护另一套 jsquash WebP/AVIF 初始化流程。保持原始尺寸时，两种格式都通过 `createImageBitmap` 解码为 RGBA，并在 `finally` 中关闭 `ImageBitmap`；传入目标尺寸时改用第 4 条的 WASM RGBA 缩放路径，不生成 Canvas 中间图片。WebP 的普通/SIMD WASM 通过 SDK 的 `locateFile` 映射；AVIF 保留 Emscripten 主模块、线程 Worker 和 Worker 内动态导入的原生模块关系，由 Webpack 在同一打包上下文中生成可访问 URL。共享 Rust 产物分别由 `@picbind/image-wasm` 和 `@picbind/perceptual-wasm` 包提供，生成的 JS、类型声明和 WASM 二进制随包提交；全部前端包由仓库根 `pnpm-workspace.yaml` 和 `pnpm-lock.yaml` 统一管理。
4. 同格式且保持原始像素尺寸时，结果不小于源文件会返回原 Blob。Room 压缩弹窗同时提供固定原图宽高比的目标尺寸输入，不允许解除比例锁定；修改任一边会自动计算另一边。主线程只把目标宽高传给专用 Worker，不执行像素缩放。目标尺寸与原图不同时，`image-wasm` 使用 `Lanczos3` 在编码前生成目标像素：JPEG/PNG 通过 `compress_image_to_format_with_resize_options` 在同一 WASM 调用内完成解码、缩放和编码；WebP/AVIF 通过 `resize_image_to_rgba` 获取 WASM 缩放后的 RGBA，再交给对应 jsquash 编码器。自动格式预测使用目标尺寸 RGBA。改变尺寸时不会执行同格式返回原图保护，否则会错误恢复原始尺寸。目标单边限制为 `16384` 像素，RGBA 缓冲上限为 `128 MB`。
5. 压缩、转换和编辑结果统一进入结果弹窗。用户可选择“存储到本地”或“分享给对方”：本地存储会创建独立的根图片并进入左侧本地图片列表；分享会创建独立图片、生成 placeholder、发送接收确认请求，并在弹窗中依次展示准备、等待确认、传输和接收完成状态。对方拒绝时不会自动保存生成图，结果弹窗会提供“保存”和“不保存”，分别将临时图片移入左侧列表或彻底删除。图片 Blob 写入 OPFS，Dexie / IndexedDB 只记录图片元数据、工作区位置和关联字段。
6. Room 当前不启用首页的 Butteraugli 外层多候选校验，也不复用首页 Worker 并发队列。每次 Room 压缩会创建一个专用的一次性 Worker，完成或失败后立即终止。
7. Room 压缩弹窗允许在压缩期间终止任务。点击“取消压缩”会触发 `AbortController` 并直接终止当前压缩 Worker，但保留弹窗以便重新选择格式和启动压缩；关闭按钮或 `Esc` 会终止任务并关闭弹窗。点击遮罩不会关闭压缩、格式转换、裁剪、尺寸调整或色彩调整弹窗，避免编辑结果因误触丢失。正在执行的 WASM 编码和 Worker 内存会一起停止和释放，任务代次标记同时防止旧任务结果覆盖后续状态。
8. Room 图片操作菜单提供裁剪和尺寸调整。裁剪选区由现有 Konva 画布和 Transformer 实现，支持自由比例、原始比例、1:1、4:3、3:4、16:9 和 9:16；尺寸调整支持锁定原始宽高比或自由输入宽高。裁剪、尺寸调整和色彩调整先通过 `OffscreenCanvas` 生成实际像素，Canvas PNG 仅作为短生命周期的无损像素载体，随后由 Room 专用 Worker 调用共享编码链重新编码为源格式：JPEG、PNG、WebP、AVIF 分别保持 JPEG、PNG、WebP、AVIF，不再因浏览器编码能力静默回退成其他格式。JPEG/PNG 使用 `image-wasm`（PNG 包含量化及 Oxipng/Zopfli 优化），WebP/AVIF 使用 `@picbind/image-codecs`；最终结果不会直接返回体积较大的 Canvas PNG。编码以原文件大小作为参考，并针对编辑输出执行一次格式专用编码：JPEG/WebP 使用质量 `78`，PNG 使用质量 `78` 与 Gain `1.12`，AVIF 使用质量 `58`；JPEG 使用 Gain `1.08`。编辑流程不执行串行多候选搜索，避免全尺寸色彩计算后重复运行高开销编码器。编辑结果不能套用同格式返回原 Blob 保护，因为原 Blob 不包含编辑内容；透明源格式仍保留 Alpha，JPEG 不引入 Alpha。编辑生成的临时 `ImageBitmap` 在完成或失败后关闭，每次编码 Worker 在完成或失败后立即终止。
9. Room 格式转换弹窗支持用户显式选择 JPEG、PNG、WebP 或 AVIF，并禁用当前源格式。转换任务复用 Room 专用压缩 Worker 和对应目标格式编码链，操作类型记录为 `convert`，不会进入自动格式推荐。跨格式转换不执行“结果必须小于源文件”保护，因为用户明确要求改变格式。普通压缩仍禁止静默丢失真实 Alpha；但用户在格式转换弹窗中显式选择 JPEG 时，转换任务会单独传入 `allowAlphaLoss=true`，将 WebP、PNG 或 AVIF 的透明区域与白色背景合成后再编码 JPEG。取消转换会直接终止 Worker 并保留弹窗，关闭弹窗则终止 Worker 后退出。
10. Room 图片使用持久化的 `workspaceLocation` 区分左侧 `library` 与主区域 `outbox`，并使用 `outboxOrigin` 记录图片由 `library`、直接生成或对方接收进入右侧。新导入图片只进入 `library`，文件选择阶段不会生成 placeholder，也不会弹出压缩建议；用户点击加入待发送区域时才按正常网络 `1 MB`、弱网 `300 KB` 的阈值决定是否提示压缩，确认继续后再切换到 `outbox`、生成 placeholder 并通知对方。裁剪、尺寸调整、格式转换和色彩调整生成的新图片在选择分享时也经过相同阈值；已经由 Room 压缩弹窗生成的结果不重复提示，Review 输出遵循第 13 节的直接分享流程。选择压缩会直接打开 Room 内部压缩弹窗，不再离开房间跳转到首页；弹窗左侧固定展示原图及其文件信息，右侧作为压缩结果等待区，完成后展示结果图、格式、尺寸和体积变化。右侧统一使用垃圾桶按钮：`library` 来源点击后无需确认，直接移回左侧并通知对方删除对应占位；直接生成、分享成功或接收的图片点击后显示“取消 / 删除 / 移入左侧”，删除仅清理当前端，移入左侧也不会删除对端副本。接收图片移入左侧时会转换为具有新 ID 的本端独立图片，避免后续再次发送时与对端原对象冲突。待发送区卡片可以在当前端置顶，`pinnedAt` 持久化到 Dexie / IndexedDB；置顶项按最近置顶时间优先，未置顶项中带有 `wantedByPeer` 的提供方图片排在普通图片之前，其余继续按 `updatedAt` 倒序排列。置顶状态不向对端同步，取消“想要”会恢复普通排序。只有 `received` 图片允许点赞，自己的 `sent` 图片只展示对方产生的点赞数和红心动画。点击可点赞的图片区域会即时累计并持久化 `likeCount`，网络事件按图片进入内存队列，延迟 `2s` 后每批最多 `12` 张图片、单图最多 `100` 次增量通过 instruction 通道发送；只有成功写入通道的增量才从队列扣除，断线时保留并延迟重试。接收端按增量累加计数，并在图片容器内错峰生成本地红心动画，不传输动画帧。尚未收到原图的接收卡片可以切换“想要”状态，再次点击会取消；双方分别持久化 `wantedByMe` 和 `wantedByPeer`，并通过布尔事件同步高亮与取消。图片对象分别持久化不可变的创建时间 `createdAt` 和列表位置更新时间 `updatedAt`；只有新建对象及在 `library`、`outbox` 之间移动时才更新 `updatedAt`，传输进度和状态变化不会更新它。两个时间会随 placeholder、P2P/R2 元数据和处理图片分享请求发送，接收端在完整二进制替换占位时保持不变；左右列表及刷新恢复均按 `updatedAt` 倒序排列。分享接收确认弹窗会报告预览容器尺寸，并通过独立 thumbnail 通道接收缩略图；只有缩略图实际到达后才显示长按查看按钮。接收方确认接收分享后会立即创建合法空 Blob 的占位卡片，完整二进制到达后原位替换并保留互动字段。本次 Dexie 架构不迁移旧 SQLite 数据。
11. Room 色彩调整按“基础光影、色彩属性、色调平衡、进阶重构”四类组织。实际像素管线保持 RGB 通道增益、亮度/对比度、黑点/中间调/白点色阶、RGB 色调曲线、全局色相/饱和度/自然饱和度、指定色域局部 HSL、色温、分区色彩平衡、照片滤镜、颜色替换以及黑白/棕褐/单色重着色的既有顺序。基础通道与光影步骤预编译为三个 `256` 项 LUT，逐像素循环只执行当前设置实际启用的 HSL、色彩平衡、滤镜、替换和重着色阶段；未启用阶段不再做浮点运算，也不再为每个像素创建 HSL 数组、色调权重对象或闭包。色调曲线支持添加、移动和删除控制点，端点保留且可调整输出值，控制点最多 `12` 个；处理时按输入值排序，经 Catmull-Rom 插值生成 `256` 项 LUT。弹窗在最长边不超过 `720×420` 的 Canvas 预览副本上执行同一像素函数，连续操作按约 `36 ms` 合并更新。最终输出的原始尺寸像素循环由独立 `room-color-adjustment.worker.ts` 执行，避免大图处理阻塞弹窗主线程；调整后的 RGBA 在同一个 Worker 内直接交给 PNG、WebP 或 AVIF 编码器，JPEG 因当前 WASM 未提供公开 RGBA 入口而在该 Worker 内使用一次临时 PNG 载体，不再把临时 PNG 传回主线程后启动第二个 Worker。颜色替换可从预览点击取样，Alpha 始终保持原值且不会被静默压平；生成结果记录为 `adjust`，后续由统一结果弹窗决定本地存储或分享。全部设置保持默认值时禁止生成无意义结果。
12. Review 标注线宽以图片归一化比例保存，渲染时乘以原图到当前适配画布的缩放比例。因此不同像素尺寸的图片在相同线宽档位和初始适配视图下具有一致的屏幕视觉粗细，同时图形自身拉伸不会放大描边。自由画笔、直线、箭头、矩形、圆形、虚线和圆点线共用该换算。Transformer 锚点、旋转手柄、旋转偏移和选框边框属于操作 UI，只按视口缩放反向补偿，不受原图分辨率影响。
13. Review 保存图片时先在全尺寸 `OffscreenCanvas` 合成原图与标注快照，但合成得到的 PNG 只作为临时无损像素载体，不再直接作为最终文件。随后通过一次性压缩 Worker 编码为源图格式：JPEG、PNG 使用共享 `image-wasm`，WebP、AVIF 使用 Room 现有对应编码器。若首选结果超过 `max(原图大小 × 1.5, 原图大小 + 512 KB)`，会额外尝试 WebP；WebP 源则尝试 AVIF，并选择两个有效结果中更小的一个。该护栏不能退回原图，因为原图不包含新标注。最终文件名在原文件主名称后添加 `-annotated`，并使用实际编码格式的扩展名。保存结果始终作为具有独立 ID、独立根节点和完整 Blob 的新图片写入，不会成为或替换原图版本。最终预览弹窗提供“保存”和“分享”：保存直接进入左侧本地图片列表；分享直接向对方发送接收请求，不再触发额外的大小压缩提示，且弹窗在等待确认和传输期间保持显示。对方接受后，弹窗展示传输阶段，成功时双方图片均位于待发送主区域；对方拒绝后，分享方可选择把生成图保存到左侧列表或丢弃临时图片。最终预览弹窗展示实际输出格式与压缩后体积，点击遮罩不会关闭弹窗。
14. 新版 Image Workspace 的协作图片使用延迟物化流程。裁剪、尺寸调整、色彩调整、旋转和 Doodle 在协作状态下只提交版本化 JSON 参数；画布、卡片和对端同步使用最长边受限的 WebP 预览，参数提交不会调用全尺寸编辑编码器，也不会用预览 Blob 替换完整渲染结果。Owner 使用 `Apply changes`，Collaborator 使用 `Submit proposal`；非协作图片仍使用 `Generate result` 生成独立结果。压缩和格式转换不进入协作参数栈，始终运行对应完整编码链并创建独立图片。只有保存协作图片、导出或下载时，才从缓存原图重放参数栈并物化完整结果；未获得原图的 Collaborator 只基于 Owner 已渲染预览应用新增参数，Owner 发送新预览或原图后会重建该预览基线，避免重复应用已有参数。

关键实现：

- Room 压缩适配：`packages/ui/src/utils/room-image-compression.ts`
- 压缩与预览 UI：`packages/ui/src/components/share/workspace/image-compression-dialog.tsx`
- 格式转换 UI：`packages/ui/src/components/share/workspace/image-conversion-dialog.tsx`
- 裁剪与尺寸调整 UI：`packages/ui/src/components/share/workspace/image-crop-dialog.tsx`、`packages/ui/src/components/share/workspace/konva-crop-editor.tsx`、`packages/ui/src/components/share/workspace/image-resize-dialog.tsx`
- 色彩调整 UI：`packages/ui/src/components/share/workspace/image-color-adjustment-dialog.tsx`
- 色彩实时预览：`packages/ui/src/components/share/workspace/color-adjustment-preview.tsx`
- 色调曲线编辑器：`packages/ui/src/components/share/workspace/tone-curve-editor.tsx`
- 色彩全尺寸处理与直接编码 Worker：`packages/ui/src/workers/room-color-adjustment.worker.ts`
- 处理结果动作弹窗：`packages/ui/src/components/share/workspace/image-result-dialog.tsx`
- 本地图片列表：`packages/ui/src/components/share/workspace/local-image-list.tsx`
- 色彩像素处理：`packages/ui/src/utils/room-color-adjustments.ts`
- Room 格式转换适配：`packages/ui/src/utils/room-image-conversion.ts`
- Room 图片编辑编码：`packages/ui/src/utils/room-image-editing.ts`
- Review 标注渲染：`packages/ui/src/components/share/workspace/review-annotation-layer.tsx`
- Review 图片合成与编码：`packages/ui/src/utils/review-image-export.ts`
- Image Workspace 参数预览：`packages/ui/src/workspace/parameter-preview.ts`
- Image Workspace 协作容器：`packages/ui/src/workspace/collaboration-image-container.ts`
- 图片内容身份与 metadata：`crates/picbind-image/src/content_identity.rs`
