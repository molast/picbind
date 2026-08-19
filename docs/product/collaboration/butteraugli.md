我目前正在开发一个基于 Rust + WASM 的浏览器图片压缩工具（PicBind）。

技术栈：

- Rust
- wasm-bindgen
- wasm-pack
- WebAssembly
- React + TypeScript

当前图片压缩全部运行在浏览器端 Rust WASM 中，不依赖服务器。

---

## 当前压缩流程

目前项目已经实现了一套动态压缩策略，并不是简单固定 quality 压缩。

当前流程：

原图

↓

Rust WASM 分析图片参数

（包括但不限于）

- 图片尺寸
- 图片格式
- 文件大小
- 图像特征
- 颜色信息
- 复杂度等

↓

动态生成压缩参数

↓

编码压缩

↓

输出图片

---

## 当前存在的问题

目前动态压缩方案已经可以根据图片生成合理的压缩参数。

但是实际测试发现：

部分图片虽然压缩率很好，但是压缩后仍然存在肉眼可见的细微变化。

例如：

- 文字边缘
- 线条
- 高频纹理
- 人脸细节
- 小尺寸图标

这些变化通过普通图片参数分析无法准确预测。

因此希望引入视觉质量模型。

---

# 引入 Butteraugli

目标：

接入 Butteraugli 作为视觉质量优化模型。

不是简单用于：

"压缩完成后比较两张图片"

而是：

"参与压缩决策，根据视觉误差动态调整压缩参数"

目标：

在保证视觉质量的情况下，获得尽可能小的文件。

---

# Butteraugli 依赖

请基于以下依赖设计：

Cargo.toml:

```toml
[dependencies]

wasm-bindgen = "0.x"

butteraugli = "0.9.3"
```

要求：

- 使用纯 Rust Butteraugli 实现
- 不使用 C++ Butteraugli
- 不使用 libjxl
- 不使用 FFI
- 可以通过 wasm-pack 编译为 WebAssembly

请说明：

1. butteraugli crate 如何引入
2. 是否需要额外 feature
3. wasm 环境是否需要特殊配置
4. 是否建议开启 wasm SIMD
5. 是否需要优化编译参数

---

# 希望实现的流程

当前：

原图

↓

图片参数分析

↓

生成压缩参数

↓

编码

↓

输出


希望：

原图

↓

图片参数分析

↓

生成初始压缩参数

↓

编码

↓

解码压缩结果

↓

Butteraugli 比较原图和压缩图

↓

得到视觉误差

↓

判断是否满足目标视觉质量

↓

调整压缩参数

↓

重新编码

↓

再次检测

↓

输出最终结果


---

# 核心设计要求

请重点分析：

## 1. Butteraugli 接入位置

如何融入现有动态压缩流程。

不要替代当前压缩策略。

当前策略负责：

- 快速预测初始参数

Butteraugli 负责：

- 视觉质量校正

---

## 2. 自适应压缩算法

设计：

输入：

初始压缩参数

目标 Butteraugli 分数

例如：

Excellent:
0.8

Visually Lossless:
1.0

Balanced:
1.5


输出：

满足视觉目标的最小文件。


请分析：

- 二分搜索
- 局部搜索
- 自适应搜索
- 其它算法


哪个更适合：

Rust WASM 图片压缩场景。

---

## 3. 减少性能消耗

Butteraugli 本身计算成本较高。

请设计：

如何减少：

- Encode 次数
- Decode 次数
- Butteraugli 调用次数

例如：

- 使用已有图片分析结果预测初始 quality
- 缓存历史压缩结果
- 调整搜索范围
- 提前停止

---

## 4. Rust 模块设计

请设计模块结构。

例如：

```
src

├── compression
│
├── encoder
│
├── decoder
│
├── analysis
│   ├── butteraugli.rs
│   ├── ssim.rs
│   └── mod.rs
│
└── wasm.rs
```

要求：

Butteraugli 只是 analysis 模块之一。

未来方便扩展：

- SSIM
- MS-SSIM
- SSIMULACRA2
- PSNR

---

## 5. WASM API 设计

希望 Rust 暴露：

类似：

```rust
compress_adaptive(
    image,
    options
)
```

返回：

```rust
CompressionResult {

    data: Vec<u8>,

    quality: u8,

    size: usize,

    butteraugli_score: f32

}
```

请设计合理的数据结构。

---

## 最终目标

实现：

"视觉感知压缩"

而不是：

"固定参数压缩"

最终效果：

对于不同图片：

自动找到：

文件最小

并且：

人眼几乎无法发现质量下降

的压缩结果。