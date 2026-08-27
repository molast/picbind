# Native Image Codecs

本文档说明 `picbind-image-native` 当前实际使用的图片编解码器、内部 Options、默认值和行为边界。
这里的 Options 是 Native codec 内部扩展点，不是 Image Processing API V1 的公开请求字段。

## Codec 总览

| 格式 | Decoder | Encoder | Native 像素输出 |
|---|---|---|---|
| JPEG | `zune-jpeg 0.5.15` | `mozjpeg-rs 0.8.0` | RGB8 |
| PNG | `zune-png 0.5.2` | `imagequant 4.4.1` + `lodepng 3.12.2` + `oxipng 10.2.0` | Luma8 / LumaA8 / RGB8 / RGBA8 |
| WebP | `image-webp 0.2.4` | `webp 0.3.1` + `libwebp-sys 0.9.6` | RGB8 或 RGBA8 |
| AVIF | `zenavif 0.1.6` | `ravif 0.13.0` / rav1e | RGBA8 |
| JPEG XL | `jxl-oxide 0.12.6` | `zune-jpegxl 0.5.2` | `DynamicImage` 支持的 JXL 输出布局 |

统一入口先通过 magic bytes 识别输入格式，再由格式专用 decoder 生成 `image::DynamicImage`。
五种输入均可进入五种 encoder，形成 5x5 编解码矩阵。全局输入上限为 50 MiB，单边上限为
16384，总像素上限为 100,000,000。

## JPEG

实现文件：[`jpeg/decoder/mod.rs`](jpeg/decoder/mod.rs)、[`jpeg/encoder/mod.rs`](jpeg/encoder/mod.rs)。

### JpegDecoderOptions

| 参数 | 默认值 | 约束与作用 |
|---|---:|---|
| `strict_mode` | `true` | 拒绝不符合 JPEG 规范的输入。 |
| `use_unsafe` | `true` | 允许 zune 使用当前 CPU 支持的平台 SIMD/unsafe 快速路径；关闭后可用于 scalar/safe 对照。 |
| `max_scans` | `100` | Progressive JPEG 最大扫描数，必须大于 `0`。 |

Decoder 固定请求 `ColorSpace::RGB`，灰度 JPEG 也扩展为 RGB8。宽高分别受 16384 限制。

### JpegEncoderOptions

| 参数 | 默认值 | 约束与作用 |
|---|---:|---|
| `quality` | `80` | `1..=100`。 |
| `allow_alpha_loss` | `false` | 为 `false` 时，codec 边界直接拒绝带真实透明像素的 JPEG 输出。 |
| `alpha_background` | `[255, 255, 255]` | 明确允许丢失 Alpha 时使用的合成背景色。 |
| `preset` | `ProgressiveBalanced` | MozJPEG preset。 |
| `progressive` | `true` | 输出 Progressive JPEG。 |
| `optimize_huffman` | `true` | 启用 Huffman 表优化。 |
| `subsampling` | `None` | `None` 时按质量选择：`>=96` 使用 4:4:4，`90..=95` 使用 4:2:2，其余使用 4:2:0。 |
| `smoothing` | `0` | MozJPEG smoothing，`0..=100`。使用自定义量化表且质量高于 80 时，最低值按 `(quality - 75) * 0.4` 提升，避免高质量量化表导致 DCT 系数溢出。 |
| `quantization_table` | `ImageMagick` | 内建量化表类型；自定义 luma/chroma 表会覆盖对应分量。 |
| `custom_luma_qtable` | `None` | 可选 64 项亮度量化表，每项必须大于 `0`。 |
| `custom_chroma_qtable` | `None` | 可选 64 项色度量化表，每项必须大于 `0`。 |
| `trellis` | `TrellisConfig::default()` | AC/DC trellis、EOB、lambda、循环次数和 speed mode 等纯 Rust MozJPEG 参数。依赖中的 `use_scans_in_trellis` 与 `q_opt` 尚未实现，设置它们不会产生 multipass / qtable trellis 效果。 |
| `optimize_scans` | `false` | 搜索 Progressive scan 脚本；可进一步缩小文件，但会显著增加编码时间。 |
| `overshoot_deringing` | `true` | 降低高对比边缘的 ringing。 |
| `fast_color` | `false` | `false` 保持与 C MozJPEG 一致的颜色转换；`true` 使用更快的转换，可能产生不可见的舍入差异。 |
| `restart_interval` | `0` | 每隔指定 MCU 行写 restart marker；`0` 表示禁用。 |

Encoder 只接受非空单帧像素。现成 Luma8/RGB8 缓冲直接借用，Luma16 规范为 Luma8，其他无
Alpha 布局规范为 RGB8；灰度走单分量 `encode_gray`，彩色走 `encode_rgb`。带 Alpha 的输入会
先扫描是否存在真实透明像素：没有透明像素时可直接移除 Alpha，存在透明像素则必须显式允许，
再按 `alpha_background` 合成。当前纯 Rust `mozjpeg-rs 0.8.0` 不提供 rimage/C MozJPEG 的输出
`color_space` 切换，也没有有效的 trellis multipass，因此没有把这两项描述为可用能力。

## PNG

实现文件：[`png/decoder/mod.rs`](png/decoder/mod.rs)、[`png/encoder/mod.rs`](png/encoder/mod.rs)。

### PngDecoderOptions

| 参数 | 默认值 | 约束与作用 |
|---|---:|---|
| `strict_mode` | `true` | 校验 PNG CRC 和 zlib Adler，拒绝不符合格式规范的输入。 |
| `use_unsafe` | `true` | 允许 zune 使用平台 SIMD/unsafe 快速路径。 |
| `strip_to_8bit` | `true` | 将 16-bit PNG 规范为当前 Native 主模型使用的 8-bit；关闭后当前适配层会拒绝非 8-bit 解码结果。 |

Decoder 保留 Luma、LumaA、RGB、RGBA 和调色板 `tRNS` 透明度。APNG 当前只读取首帧，宽高
分别受 16384 限制。

### PngEncoderOptions

| 参数 | 默认值 | 约束与作用 |
|---|---:|---|
| `quality` | `80` | imagequant 感知质量上限，`1..=100`。 |
| `quantize` | `true` | 启用 imagequant 调色板量化；关闭时直接从原颜色布局生成 OxiPNG 无损结果。 |
| `compare_lossless` | `true` | 同时生成量化和无损结果并选择较小者；任一候选失败时保留另一个有效结果。 |
| `max_colors` | `256` | 调色板颜色数，`2..=256`。 |
| `quantization_speed` | `5` | imagequant speed，`1..=10`；值越大速度越快。 |
| `dithering_level` | `0.0` | 抖动强度，`0.0..=1.0`。 |
| `oxipng_options` | preset `1`, `force=true` | 完整 `oxipng::Options`：可配置 filters、颜色/位深缩减、Alpha 优化、chunk strip、interlace、timeout、内存上限与 deflater。默认使用 libdeflater level 10；已编译可选 Zopfli 支持，但默认不启用。 |

量化路径借用现有交错 RGBA 缓冲，经 imagequant 和 lodepng 生成带 Alpha 的索引色 PNG，再用
OxiPNG 优化；优化失败或没有变小时保留有效的 lodepng 结果。无损路径参照 rimage 的
`encode_inner`，直接构造 `oxipng::RawImage`，保留 Luma、LumaA、RGB、RGBA 与 8/16-bit 布局，
16-bit 样本按 PNG 网络字节序写入，Float32 规范为 16-bit。当前模型是单帧 `DynamicImage`，动画
decoder 已在 codec 边界选择首帧；空图会在构造 `RawImage` 前返回错误。

## WebP

实现文件：[`webp/decoder/mod.rs`](webp/decoder/mod.rs)、[`webp/encoder/mod.rs`](webp/encoder/mod.rs)。

### WebPDecoderOptions

| 参数 | 默认值 | 约束与作用 |
|---|---:|---|
| `memory_limit` | `400,000,000` bytes | 必须大于 `0`；限制输出像素缓冲并传给 `image-webp` decoder。它不是整个进程的绝对内存上限。 |
| `use_simple_upsampling` | `false` | `false` 使用 Bilinear 色度上采样；`true` 使用较快但边缘可能更锯齿的 Simple 上采样。 |

Decoder 在分配输出缓冲前检查 16384 单边限制和 100,000,000 总像素限制。无 Alpha 文件输出
RGB8，含 Alpha 文件输出 RGBA8；动画 WebP 当前由 `read_image` 读取首帧。

### WebPEncoderOptions

| 参数 | 默认值 | 约束与作用 |
|---|---:|---|
| `lossless` | `0` | `0` 为有损，`1` 为无损。无损模式下 `quality` 表示压缩 effort。 |
| `quality` | `80.0` | `0..=100`。有损模式下控制质量/体积，无损模式下控制压缩 effort。 |
| `method` | `5` | 压缩 method，`0..=6`；值越大通常编码越慢。 |
| `image_hint` | `WEBP_HINT_DEFAULT` | 底层图像类型提示。`webp 0.3.1` 只重导出 `WebPConfig`，没有重导出该枚举，因此当前 wrapper 保留默认值。 |
| `target_size` | `0` | 目标字节数，必须大于等于 `0`；非零时覆盖 quality 目标。 |
| `target_PSNR` | `0.0` | 最低目标 PSNR，必须大于等于 `0`；非零时优先于 `target_size`。 |
| `segments` | `4` | 最大分段数，`1..=4`。 |
| `sns_strength` | `50` | Spatial Noise Shaping 强度，`0..=100`。 |
| `filter_strength` | `60` | 环路滤波强度，`0..=100`。 |
| `filter_sharpness` | `0` | 滤波 sharpness，`0..=7`。 |
| `filter_type` | `1` | `0` 为 simple，`1` 为 strong。 |
| `autofilter` | `0` | `0` 关闭，`1` 自动选择滤波强度。 |
| `alpha_compression` | `1` | `0` 不压缩 Alpha，`1` 使用 WebP lossless 压缩 Alpha。 |
| `alpha_filtering` | `1` | Alpha 预测滤波：`0` none、`1` fast、`2` best。 |
| `alpha_quality` | `100` | Alpha 质量，`0..=100`。 |
| `pass` | `1` | 熵分析次数，`1..=10`。 |
| `show_compressed` | `0` | `1` 时把压缩图回写到 picture；当前正常编码保持关闭。 |
| `preprocessing` | `0` | 预处理 bit flags，`0..=7`；常用值为 `0` none、`1` segment smoothing、`2` pseudo-random dithering。 |
| `partitions` | `0` | token partitions 数量的 `log2`，`0..=3`。 |
| `partition_limit` | `0` | 为满足 prediction modes 512 KiB 限制允许的质量降级，`0..=100`。 |
| `emulate_jpeg_size` | `0` | `1` 时重映射参数以接近 JPEG 输出大小。 |
| `thread_level` | `0` | `1` 时请求 libwebp 多线程编码。 |
| `low_memory` | `0` | `1` 时以更多 CPU 时间换取更低内存占用。 |
| `near_lossless` | `100` | `0..=100`；`100` 关闭 near-lossless，值越低允许的像素变化越大。 |
| `exact` | `0` | `1` 时保留全透明区域下的精确 RGB；默认丢弃不可见 RGB 以提高压缩率。 |
| `use_delta_palette` | `0` | libwebp 保留字段，当前没有已实现的 lossless 行为。 |
| `use_sharp_yuv` | `0` | `1` 时使用更慢的 Sharp YUV RGB 转换。 |
| `qmin` | `0` | 最低允许质量因子，需满足 `0 <= qmin <= qmax <= 100`。 |
| `qmax` | `100` | 最高允许质量因子，需满足 `0 <= qmin <= qmax <= 100`。 |

`WebPEncoderOptions` 直接包装完整的 `webp::WebPConfig`。默认仍输出有损 WebP，但内部 Options
也可启用 lossless 和 libwebp 的高级参数；无效配置在编码前由 libwebp 校验并映射为
`InvalidParameters`。Encoder 拒绝空图，现成 RGB8/RGBA8 缓冲直接借用，其他布局按 Alpha
状态只转换一次，再分别通过 `Encoder::from_rgb` / `Encoder::from_rgba` 和 `encode_advanced`
编码。`webp 0.3.1` 是 `libwebp-sys 0.9.6` 的安全 Rust wrapper，后者从随 crate 提供的 C
libwebp 源码静态编译，因此该 encoder 不是纯 Rust 实现。

## AVIF

实现文件：[`avif/decoder/mod.rs`](avif/decoder/mod.rs)、[`avif/encoder/mod.rs`](avif/encoder/mod.rs)。

### AvifDecoderOptions

| 参数 | 默认值 | 约束与作用 |
|---|---:|---|
| `threads` | `1` | zenavif decoder 线程数。当前固定单线程，规避 macOS ARM 上 rav1d-safe tile threading panic。 |
| `prefer_8bit` | `true` | 将 10/12-bit 输入规范为 RGBA8。 |

RGB8 解码结果会补不透明 Alpha 转为 RGBA8；其他像素布局返回明确错误。

### AvifEncoderOptions

| 参数 | 默认值 | 约束与作用 |
|---|---:|---|
| `quality` | `80` | 主图质量，`1..=100`。 |
| `alpha_quality` | `None` | `Some` 时为 `1..=100`；`None` 时跟随主图质量。 |
| `speed` | `9` | ravif speed，`1..=10`；值越大速度越快。 |
| `color_model` | `YCbCr` | ravif 内部颜色模型。 |
| `alpha_color_mode` | `UnassociatedClean` | 保持未预乘、清理透明像素颜色。 |
| `bit_depth` | `Eight` | 当前默认 8-bit 编码。 |
| `num_threads` | `None` | `None` 使用全局 Rayon 池；`Some` 必须大于 `0`。 |

Encoder 接收 Native 单帧 `DynamicImage`；当前 decoder 已在进入 encoder 前选定静态帧或动画
首帧，因此这里没有多帧集合可继续展开。编码前会拒绝零宽或零高图片，并将像素准备为 8-bit：
现成 RGB8/RGBA8 缓冲直接借用，其他无 Alpha 布局只物化一次 RGB8，带 Alpha 布局只物化一次
RGBA8。RGB 调用 `ravif::Encoder::encode_rgb`，RGBA 调用 `encode_rgba`；全不透明 RGBA 由
`ravif` 自动省略 Alpha 平面。同格式多候选在循环外完成一次像素准备并复用，避免每个质量候选
重复转换。

## JPEG XL

实现文件：[`jpeg_xl/decoder/mod.rs`](jpeg_xl/decoder/mod.rs)、
[`jpeg_xl/encoder/mod.rs`](jpeg_xl/encoder/mod.rs)。

### JpegXlDecoderOptions

| 参数 | 默认值 | 约束与作用 |
|---|---:|---|
| `threads` | `None` | `None` 使用 jxl-oxide 全局 Rayon 池；`Some` 必须大于 `0`。 |

Decoder 同时支持 `FF 0A` codestream 和 JXL container signature。当前只使用静态图片输出，
并在物化前检查 100,000,000 总像素限制。

### JpegXlEncoderOptions

| 参数 | 默认值 | 约束与作用 |
|---|---:|---|
| `effort` | `4` | `0..=127`。 |
| `num_threads` | `4` | scoped worker 数；`0` 禁用 encoder worker threads。 |
| `bit_depth` | `Eight` | 当前只接受 8-bit RGB/RGBA。 |

Encoder 当前生成单帧无损 codestream、剥离 metadata，并根据真实 Alpha 选择 RGB8 或 RGBA8。
公开请求中的 `quality` 和 Compression Gain 当前不会改变 JXL 码流参数。

## 统一兼容规则

- 同格式压缩结果不小于源文件时，由 Engine 返回原文件；跨格式强制转换不应用该规则。
- 除非请求明确允许，透明输入不能编码为 JPEG 并静默丢失 Alpha。
- PNG、WebP、AVIF 和 JPEG XL 的透明度必须保留。
- Planner 的单个候选编码或回读失败不能丢弃其他有效候选；取消错误必须立即向上传播。
- `decode` / `encode` 等简化入口仅负责构造默认 Options，具体算法行为以格式专用实现为准。
