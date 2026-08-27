# Native Image Codecs

本文档说明 `picbind-image-native` 当前实际使用的图片编解码器、内部 Options、默认值和行为边界。
这里的 Options 是 Native codec 内部扩展点，不是 Image Processing API V1 的公开请求字段。

## Codec 总览

| 格式 | Decoder | Encoder | Native 像素输出 |
|---|---|---|---|
| JPEG | `zune-jpeg 0.5.15` | `mozjpeg-rs 0.8.0` | RGB8 |
| PNG | `zune-png 0.5.2` | `imagequant 4.4.1` + `lodepng 3.12.2` + `image 0.25` PNG encoder + `oxipng 10.2.0` | Luma8 / LumaA8 / RGB8 / RGBA8 |
| WebP | `image-webp 0.2.4` | `zenwebp 0.4.4` | RGB8 或 RGBA8 |
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
| `allow_alpha_loss` | `false` | 为 `false` 时，上层必须拒绝带真实 Alpha 的 JPEG 输出。 |
| `alpha_background` | `[255, 255, 255]` | 明确允许丢失 Alpha 时使用的合成背景色。 |
| `preset` | `ProgressiveBalanced` | MozJPEG preset。 |
| `progressive` | `true` | 输出 Progressive JPEG。 |
| `optimize_huffman` | `true` | 启用 Huffman 表优化。 |
| `subsampling` | `None` | `None` 时按质量选择：`>=96` 使用 4:4:4，`90..=95` 使用 4:2:2，其余使用 4:2:0。 |

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
| `quantize` | `true` | 启用 imagequant 调色板量化；关闭时输出无损 RGBA PNG。 |
| `compare_lossless` | `true` | 同时生成量化和无损结果并选择较小者；量化失败时保留有效的无损结果。 |
| `max_colors` | `256` | 调色板颜色数，`2..=256`。 |
| `quantization_speed` | `5` | imagequant speed，`1..=10`；值越大速度越快。 |
| `dithering_level` | `0.0` | 抖动强度，`0.0..=1.0`。 |
| `oxipng_options` | preset `1`, `force=true` | 最终无损优化配置；只有结果更小时才采用 OxiPNG 输出。 |

量化路径借用现有交错 RGBA 缓冲，生成带 Alpha 的索引色 PNG；无损路径使用 Best compression
和 Adaptive filter。

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
| `quality` | `80` | 有损主图质量，`1..=100`。 |
| `method` | `5` | 压缩 method，`0..=6`；值越大通常编码越慢。 |
| `alpha_quality` | `100` | Alpha 质量，`0..=100`。 |

Encoder 当前统一接收 RGBA8 并通过 `zenwebp::LossyConfig` 输出有损 WebP。

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
