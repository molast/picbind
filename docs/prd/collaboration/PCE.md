# PicBind Compression Engine（PCE）

## 整体架构

```text
               ┌────────────────────┐
               │    Input Image     │
               └─────────┬──────────┘
                         │
                         ▼
            ┌─────────────────────────┐
            │  Feature Extractor       │
            │（图片特征提取器）          │
            └─────────┬───────────────┘
                      │
                      ▼
          ┌───────────────────────────┐
          │ Image Feature Analyzer     │
          │（图片特征分析器）           │
          └─────────┬─────────────────┘
                    │
                    ▼
          ┌───────────────────────────┐
          │ Compression Planner        │
          │（压缩策略生成器）           │
          └─────────┬─────────────────┘
                    │
                    ▼
          ┌───────────────────────────┐
          │ Encoder Selector           │
          │（编码器选择器）            │
          └─────────┬─────────────────┘
                    │
                    ▼
               Image Encoder
                    │
                    ▼
              Compressed Image
```

---

# 一、Feature Extractor（图片特征提取器）

负责对图片进行一次扫描，提取所有可用于分析的数据。

## 1、基础信息

- 图片宽度（Width）
- 图片高度（Height）
- 总像素数（Pixel Count）
- 图片格式（JPEG / PNG / WebP / AVIF）
- 是否包含 Alpha
- EXIF 信息
- ICC Color Profile

---

## 2、颜色特征（Color Features）

用于判断颜色复杂程度。

例如：

- Color Count（颜色数量）
- Color Diversity（颜色分布）
- Dominant Color（主色）
- HSV 分布
- RGB 方差
- Color Entropy（颜色熵）

---

## 3、纹理特征（Texture Features）

用于判断图片细节。

例如：

- Edge Density（边缘密度）
- Sobel Gradient
- Laplacian Variance
- Local Variance
- Texture Complexity
- Noise Level

---

## 4、空间特征（Spatial Features）

例如：

- 高频纹理比例
- 大面积纯色区域
- 大面积渐变区域
- Block Complexity
- Region Complexity

---

## 5、压缩特征（Compression Features）

例如：

- JPEG Quality Estimation
- JPEG Block Artifact
- Chroma Complexity
- Alpha Coverage
- Palette Potential（是否适合索引色）

---

最终输出：

```rust
ImageFeature {
    width,
    height,
    pixel_count,

    alpha,

    entropy,
    edge_density,
    texture_complexity,
    noise_level,

    color_diversity,
    palette_probability,

    gradient_ratio,
    flat_region_ratio,

    jpeg_quality_estimation,
}
```

---

# 二、Image Feature Analyzer（图片特征分析器）

这一层不负责压缩。

它只负责回答：

> **这是一张怎样的图片？**

例如：

```text
颜色复杂度：

★★★★★

纹理复杂度：

★★★☆☆

边缘数量：

★★★★☆

渐变：

★★☆☆☆

Alpha：

无

Palette：

不推荐
```

最终生成：

```rust
ImageAnalysis {
    texture_score,
    edge_score,
    entropy_score,
    palette_probability,
    gradient_score,
    noise_score,
    alpha_score,
}
```

注意：

这里**不要定义"照片、UI、漫画"等图片类型**。

分析器只输出客观特征。

---

# 三、Compression Planner（压缩策略生成器）

这是整个压缩引擎的大脑。

它根据分析结果自动生成压缩方案。

例如：

```text
输入：

ImageAnalysis

↓

输出：

CompressionPlan
```

例如：

```rust
CompressionPlan {

    encoder: MozJPEG,

    quality: 84,

    progressive: true,

    chroma_sampling: YUV420,

    trellis: true,

    optimize_scans: true,

    butteraugli: false,

}
```

或者：

```rust
CompressionPlan {

    encoder: PNG,

    palette: true,

    palette_colors: 128,

    alpha: false,

    oxipng_level: 4,

}
```

或者：

```rust
CompressionPlan {

    encoder: AVIF,

    cq_level: 28,

    effort: 6,

}
```

Planner 不关心编码细节。

它只负责：

> **生成最优压缩方案。**

---

# 四、Encoder Selector（编码器选择器）

根据 Compression Plan 自动选择编码器。

例如：

```text
CompressionPlan

↓

EncoderSelector

↓

MozJPEG
```

或者：

```text
CompressionPlan

↓

EncoderSelector

↓

Oxipng
```

或者：

```text
CompressionPlan

↓

EncoderSelector

↓

AVIF Encoder
```

这一层负责：

- 创建 Encoder
- 初始化参数
- 调用编码器

不参与任何策略计算。

---

# 五、Image Encoder（编码执行器）

真正完成图片编码。

例如：

JPEG：

- MozJPEG

PNG：

- Oxipng
- pngquant（按策略启用）

WebP：

- libwebp

AVIF：

- libavif

JXL（未来）：

- JPEG XL Encoder

Encoder 只负责：

> **按照 Compression Plan 执行压缩。**

不参与任何分析。

---

# 六、Perceptual Evaluator（可选）

用于高质量压缩模式。

例如：

Butteraugli

或者：

SSIMULACRA2

流程：

```text
编码完成

↓

Butteraugli

↓

误差过高

↓

重新调整 Quality

↓

重新编码
```

形成：

```text
Feature
      ↓
Analyzer
      ↓
Planner
      ↓
Encoder
      ↓
Evaluator
      ↓
（必要时反馈给 Planner）
```

形成闭环。

---

# 整体职责划分

| 模块 | 职责 |
|------|------|
| Feature Extractor | 提取图片原始特征数据 |
| Image Feature Analyzer | 分析图片内容，生成特征评分 |
| Compression Planner | 根据分析结果生成压缩方案 |
| Encoder Selector | 选择并配置编码器 |
| Image Encoder | 执行图片压缩 |
| Perceptual Evaluator（可选） | 感知质量评估与反馈优化 |

---

# 设计理念

PicBind 不采用固定压缩参数，而是遵循：

> **Analyze → Plan → Encode → Evaluate**

每张图片都会先经过特征分析，再生成最适合当前图片的压缩策略，最后由对应编码器执行压缩。

整个系统以图片特征为驱动，而非以固定质量值或固定算法为核心，实现真正的智能压缩。