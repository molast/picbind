<div align="center">

# 🖼️ PicBind

**本地优先的图片处理与实时协作工作台**

在浏览器或桌面端处理图片、生成 Favicon，并与协作者共享工作区。

<p>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-2024-000000?logo=rust&logoColor=white" alt="Rust 2024"></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white" alt="Next.js 14"></a>
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=000000" alt="Tauri 2"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-D22128" alt="Apache 2.0 license"></a>
</p>

<p>
  <a href="https://picbind.com">在线体验</a>
  ·
  <a href="#快速开始">快速开始</a>
  ·
  <a href="#项目结构">项目结构</a>
  ·
  <a href="#文档">文档</a>
</p>

</div>

## ✨ 项目简介

PicBind 将图片处理、质量分析、Favicon 工具和 Workspace 实时协作整合到一个 monorepo 中。
图片优先在用户设备上完成处理：Web 使用 Rust/WASM，Desktop 使用 Native Rust；Cloudflare
Worker 只负责 API、认证、信令和实时消息转发。

核心原则：

- 🔒 **本地优先**：图片原始数据和预览默认留在当前设备，不上传到 Worker 的 D1、R2、KV 或 Durable Object。
- ⚡ **按平台选择引擎**：Web 使用 WASM，Tauri Desktop 使用 Native Rust，并通过统一的 Image Processing API 接入。
- 🤝 **实时协作**：Workspace 元数据通过 WebSocket Relay 传递，图片预览和原始数据优先走 WebRTC DataChannel，必要时回退到 WebSocket。
- 🧩 **可扩展架构**：共享协议、存储、网络、UI 和图片编解码分别位于独立 package/crate 中。

## 🚀 功能亮点

| 模块 | 能力 |
| --- | --- |
| 🗜️ 图片压缩 | PNG、JPEG、WebP、AVIF；支持批量处理、自动压缩、质量分析、单文件下载和 ZIP 下载。 |
| 🎨 Favicon 工具 | 图片转换或文字生成 Favicon，支持 Google Fonts、字重、颜色、背景形状和标准图标包输出。 |
| 🤝 Workspace | Library / Working 图片流转、裁剪、缩放、颜色、涂鸦、压缩、转换、操作历史和协作提案。 |
| 📡 实时连接 | WebSocket 信令与 Relay、WebRTC 直连、连接状态和传输回退。 |
| 🖥️ Desktop | Tauri 2 客户端、Native Rust 图片管线、SQLite 本地存储、原生下载和微信 iLink 集成。 |
| 🌏 多语言 | Web、Desktop 和 Workspace 界面支持中文 / English。 |

> JPEG XL（JXL）已接入 Desktop Native 编解码矩阵；浏览器端当前以 WebAssembly 支持的格式为准。

## 🧱 架构概览

```text
                         ┌──────────────────────────┐
                         │   Cloudflare Worker      │
                         │ API · OAuth · D1 · DO    │
                         │ WebSocket Relay · TURN   │
                         └────────────┬─────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
          ┌─────────▼─────────┐               ┌─────────▼─────────┐
          │ Web · Next.js      │               │ Desktop · Tauri 2  │
          │ React + WASM       │               │ WebView + Native  │
          └─────────┬─────────┘               └─────────┬─────────┘
                    │                                   │
          ┌─────────▼─────────┐               ┌─────────▼─────────┐
          │ OPFS + Dexie       │               │ SQLite + App Data  │
          │ Browser storage    │               │ Native Rust codecs │
          └────────────────────┘               └────────────────────┘

       Image Processing API
       ├── Web: Rust/WASM codecs and perceptual analysis
       └── Desktop: picbind-image-native via Tauri bridge

       Workspace media path
       ├── WebSocket: signaling, reliable metadata, fallback relay
       └── WebRTC: preferred peer-to-peer preview/source transfer
```

## 🔧 图片编解码器

以下矩阵描述 `crates/picbind-image-native` 当前实际使用的 Desktop Native 编解码器：

| 格式 | Decoder | Encoder | 备注 |
| --- | --- | --- | --- |
| JPEG | `zune-jpeg` | `mozjpeg-rs` | Progressive、Huffman 优化和 Alpha 保护 |
| PNG | `zune-png` | `imagequant` + `lodepng` + `oxipng` | 支持量化与无损优化路径 |
| WebP | `image-webp` | `webp` / libwebp | 支持有损、无损和透明度 |
| AVIF | `zenavif` | `ravif` / rav1e | 默认 8-bit，支持透明度 |
| JPEG XL | `jxl-oxide` | `zune-jpegxl` | 当前为单帧 Native 编解码路径 |

统一 Native 引擎提供 `inspect`、`encode`、`materialize`、`renderPreview`、质量比较、缩略图和消息发送压缩入口。
同格式结果不小于原图时会保留原文件；除非明确允许，否则不会静默丢失 Alpha。

详细 Options、默认值和边界条件见 [`Native Image Codecs`](crates/picbind-image-native/src/codecs/README.md)。

## 📁 项目结构

```text
.
├── apps/
│   ├── web/                       # Next.js + React Web 应用
│   └── desktop/                   # Tauri Desktop 应用
├── packages/
│   ├── ui/                        # Workspace、协作和共享 UI
│   ├── shared/                    # TypeScript 类型、协议和运行时契约
│   └── wasm/                      # 浏览器 WASM 包与构建脚本
├── crates/
│   ├── picbind-core/              # 跨平台领域逻辑
│   ├── picbind-image/             # 图片处理 WASM crate
│   ├── picbind-image-native/      # Desktop Native 图片编解码与处理
│   ├── picbind-network/           # WebSocket、WebRTC、信令和传输
│   ├── picbind-perceptual/        # 感知质量 Rust/WASM 库
│   ├── picbind-protocol/          # 跨端稳定协议类型
│   └── picbind-storage/           # 存储和缓存抽象
├── services/
│   └── cloudflare-worker/         # API、OAuth、实时 Worker
├── docs/                          # 架构与公开说明
├── Cargo.toml                     # Rust workspace
└── pnpm-workspace.yaml            # pnpm workspace
```

## ⚙️ 快速开始

### 环境要求

- Node.js 22+
- pnpm 11.10+
- Rust stable toolchain
- `wasm-pack`（构建 WASM 时需要）
- Desktop 开发还需要 Tauri 对应平台的系统依赖；macOS 至少需要 Xcode Command Line Tools

安装依赖：

```bash
pnpm install
```

### Web 开发

```bash
pnpm dev:web
```

常用 Web 命令：

```bash
pnpm build:web                  # 构建静态产物到 apps/web/out
pnpm --dir apps/web check       # TypeScript 检查
pnpm --dir apps/web test:image-processing
pnpm --dir apps/web test:realtime
```

主要页面：

- `/`：图片压缩
- `/favicon-converter`：图片转 Favicon
- `/favicon-generator`：文字生成 Favicon
- `/workspace`：Workspace 和实时协作
- `/admin`：站点配置与统计管理

### Desktop 开发

```bash
pnpm dev:desktop                 # 启动 Web + Tauri Desktop
pnpm dev:desktop-only            # 仅启动 Desktop，需要 localhost:3000 已有 Web 服务
pnpm build:desktop               # 构建 Tauri 安装包
```

Desktop 复用 Web 前端，通过运行时 selector 选择 Web 或 Native 图片处理实现。Native 数据存储位于应用数据目录，图片处理任务通过 Tauri command 调用 Rust。

### WASM 构建

修改 `crates/picbind-image` 或 `crates/picbind-perceptual` 后执行：

```bash
pnpm build:wasm
```

生成包位于：

```text
packages/wasm/image-wasm/
packages/wasm/perceptual-wasm/
```

### Worker 本地开发

Worker 的本地 Wrangler 环境包含 API、D1、KV、Durable Object 和 WebSocket 信令：

```bash
pnpm --dir services/cloudflare-worker run d1:migrate:local
pnpm --dir services/cloudflare-worker run dev
```

默认监听 `http://localhost:8787`。Worker 路由、绑定、OAuth 配置和生产部署说明见 [`services/cloudflare-worker/README.md`](services/cloudflare-worker/README.md)。

## ✅ 检查与测试

提交前建议运行：

```bash
pnpm check:ui
pnpm check:worker
pnpm test:worker
cargo check --workspace
cargo test --workspace
```

图片处理行为改变时，还需要重新构建 WASM，并检查对应的 Native codec 文档和 Web/Desktop 适配层。

## ☁️ 部署

### Cloudflare Pages（Web）

推荐配置：

```text
Build command: pnpm install --frozen-lockfile && pnpm build:web
Build output directory: apps/web/out
```

如果 Pages 项目根目录设置为 `apps/web/`：

```text
Build command: pnpm install --frozen-lockfile && pnpm build
Build output directory: out
```

### Cloudflare Worker（API）

Cloudflare Git 部署项目根目录应设置为 `services/cloudflare-worker/`，部署命令使用：

```bash
pnpm run deploy
```

Worker 需要配置 D1、KV、Durable Object、R2、Rate Limiting 和 OAuth 等绑定。生产密钥通过 Wrangler Secret 管理，不要提交到仓库。完整接口、绑定和环境变量清单见 [`Worker README`](services/cloudflare-worker/README.md)。

## 📚 文档

- [`apps/web/README.md`](apps/web/README.md)：Web 应用说明
- [`packages/ui/README.md`](packages/ui/README.md)：共享 UI、Workspace 和协作包
- [`packages/shared/README.md`](packages/shared/README.md)：共享类型与协议
- [`crates/picbind-image-native/src/codecs/README.md`](crates/picbind-image-native/src/codecs/README.md)：Native 编解码器与 Options
- [`docs/architecture/desktop/README.md`](docs/architecture/desktop/README.md)：Desktop 架构和阶段说明
- [`services/cloudflare-worker/README.md`](services/cloudflare-worker/README.md)：Worker API、Realtime 和部署

## 🔐 数据与隐私

- Web 原图和本地缩略图写入 OPFS，业务元数据和历史记录写入浏览器数据库。
- Desktop 原图、缩略图、临时文件和缓存位于应用数据目录；图片处理在 Native Rust 中执行。
- Worker 不持久化 Workspace 图片字节；Realtime 消息只在在线协作者之间转发。
- OAuth 使用一次性状态、PKCE 和 Handoff Code，Session Token 不放入回调 URL。

## 🤝 参与贡献

提交改动前请保持变更范围聚焦，并至少运行与改动模块对应的检查。新增或替换图片编解码器、压缩策略、质量护栏或 WASM API 时，请同步更新相关实现文档和生成文件。

## 📄 License

PicBind 使用 [Apache License 2.0](LICENSE) 发布。
