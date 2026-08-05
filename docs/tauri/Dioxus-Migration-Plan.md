# PicBind Dioxus Migration Plan

> 从 React + WASM + Tauri 架构逐步迁移到 Dioxus 跨平台架构规划

版本：1.0

---

# 1. 背景

当前 PicBind 架构：

```
React
 |
 |
Rust WASM
 |
 |
图片处理能力
 |
 |
Cloudflare 服务
```

目前已经开始引入 Tauri：

```
React
 |
Tauri
 |
Rust
 |
本地文件缓存
```

当前阶段已经完成：

* Web 图片压缩
* Rust WASM 图片算法
* Dexie 本地数据存储
* Tauri 文件缓存适配

下一阶段目标：

将 PicBind 从「Web 图片工具」升级为：

> Rust 驱动的 Web + Desktop 图片工作站。

---

# 2. 当前架构存在的问题

## 2.1 图片算法分裂

当前：

```
Rust WASM

├── JPEG
└── PNG


JavaScript

├── WebP (@jsquash)
└── AVIF (@jsquash)
```

问题：

* 压缩算法无法统一
* Web 与 Desktop 无法共享
* Native 能力无法利用

---

## 2.2 Web 环境限制

Web：

* 浏览器沙箱限制
* 文件系统能力有限
* WASM能力受限
* 大图片处理受内存限制

Desktop：

可以：

* 使用本地文件系统
* 使用 Native 编解码库
* 调用 GPU
* 批量处理大量图片

---

# 3. 迁移目标

最终架构：

```
                    PicBind

                       |

                PicBind Core

                     Rust

                       |

        --------------------------------

        |                              |

       Web                         Desktop

    Dioxus Web                Dioxus Desktop

       WASM                       Native

```

---

# 4. 核心设计原则

## Rust Core First

所有核心逻辑必须脱离 UI。

禁止：

```
React
 |
业务逻辑
 |
Tauri
```

推荐：

```
UI

↓

PicBind Core

↓

Platform Layer

```

---

# 5. 最终项目结构

```
picbind/

├── crates/
│
├── picbind-core
│
│   ├── image
│   ├── compression
│   ├── cache
│   ├── storage
│   ├── sync
│   └── protocol
│
│
├── picbind-platform
│
│   ├── web
│   └── desktop
│
│
├── picbind-ui
│
│   └── dioxus
│
│
└── apps
    |
    ├── web
    |
    └── desktop

```

---

# 6. 图片压缩模块迁移

## 当前

```
React

├── WASM JPEG
├── WASM PNG
├── @jsquash WebP
└── @jsquash AVIF

```

---

## 目标

统一 Rust API：

```rust
pub enum ImageFormat {

    Jpeg,

    Png,

    Webp,

    Avif,

}


pub fn compress(
    image: &[u8],
    format: ImageFormat,
    quality: u8
)
-> Result<Vec<u8>>
```

---

# 7. 不同平台实现

## Web

目标：

```
wasm32-unknown-unknown
```

运行：

```
Dioxus Web

↓

Rust WASM

↓

Browser
```

使用：

* Rust JPEG encoder
* Rust PNG encoder
* Rust WebP encoder
* Rust AVIF encoder

---

## Desktop

目标：

Native：

```
Windows
macOS
Linux
```

使用：

* libwebp
* libavif
* mozjpeg
* oxipng
* native filesystem

架构：

```
Dioxus Desktop

↓

Rust Native

↓

系统能力

```

---

# 8. Tauri 代码迁移策略

当前：

```
src-tauri

├── commands
|
└── cache

```

调整：

```
src-tauri

├── commands

    只负责接口转换


└── core

    业务逻辑

```

原则：

Tauri 不保存业务逻辑。

---

例如：

不要：

```
React

↓

invoke()

↓

Tauri实现缓存

```

应该：

```
React/Dioxus

↓

CacheService

↓

Rust Core

```

---

# 9. 文件缓存架构

当前：

```
Dexie

↓

IndexedDB
```

未来：

抽象：

```rust
trait Storage {

    fn save();

    fn load();

    fn delete();

}

```

实现：

Web：

```
IndexedDB Adapter
```

Desktop：

```
SQLite/File Adapter
```

---

# 10. Dioxus UI迁移计划

## 阶段1

保持：

```
React Web

+

Tauri Desktop

```

目标：

完成：

* Rust Core
* 文件缓存
* 图片处理
* Storage抽象

---

## 阶段2

开发 Dioxus Desktop：

优先迁移：

* 图片工作台
* 图片列表
* 压缩设置
* 本地文件管理

---

## 阶段3

迁移 Web：

```
React

↓

Dioxus Web

```

---

# 11. Desktop 专属增强能力

## 批量处理

支持：

```
监听文件夹

↓

自动压缩

↓

自动输出

```

---

# 12. Dioxus选择理由

## 相比 React + Tauri

优势：

* UI层进入Rust生态
* 减少JS与Rust通信
* Web/Desktop共享组件
* 更适合Rust核心应用

---

## 相比 Flutter

优势：

* Rust算法直接复用
* Web路径更自然
* 包体积更小
* 更适合图片处理工具

---

# 13. 风险

## 组件生态

解决：

建立：

```
picbind-ui
```

自己的组件库。

包括：

* Button
* Panel
* Toolbar
* Dialog
* ImageViewer

---

## React迁移成本

解决：

渐进迁移。

不要一次重写。

---

# 14. 推荐执行顺序

## Step 1

抽离 Rust Core

优先：

* compression
* cache
* storage
* image pipeline

---

## Step 2

完成 Dioxus Desktop Demo

验证：

* 文件访问
* 图片加载
* Rust调用
* 打包

---

## Step 3

迁移图片工作台

---

## Step 4

迁移 Web

---

# 15. 最终目标

```
                    PicBind

                       |

                  Rust Core

                       |

        --------------------------------

        |                              |

       Web                         Desktop

    Dioxus WASM              Dioxus Native

        |                              |

 在线图片工具                 本地图片工作站

```

最终能力：

* Rust统一图片引擎
* Web + Desktop双端
* Native图片处理
* 高性能压缩
* 可扩展插件体系

---

# 结论

当前已经开始的 Tauri 文件缓存适配不会浪费。

正确方向：

```
React + Tauri
        |
        |
   抽离 Rust Core
        |
        |
Dioxus Web + Dioxus Desktop
```

未来迁移的主要成本只剩 UI 层。

核心能力：

* 图片算法
* 文件缓存
* 数据模型
* 同步协议

都可以长期复用。
