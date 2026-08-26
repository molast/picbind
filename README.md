# PicBind

PicBind 是一个基于 Rust WASM 和 Next.js 的在线图片工具站。当前重点功能是浏览器端图片压缩和 favicon 生成，图片处理尽量在本地完成，减少服务端依赖，方便部署到 Cloudflare Pages。

## 当前功能

- 图片压缩：支持 PNG、JPEG、WebP、AVIF，支持批量上传、自动压缩、单文件下载和 ZIP 打包下载。
- 压缩质量分析：在浏览器 Worker 中分析压缩前后的质量指标，用于辅助判断输出效果。
- Favicon Converter：上传图片生成 favicon 图标包。
- Favicon Generator：通过文字、Google Fonts 字体、字重、颜色和背景形状生成 favicon 图标包。
- Favicon 打包：生成 `favicon.ico`、16/32 PNG、Apple touch icon、Android chrome icon 和 `site.webmanifest`。
- 中英文切换：首页和 favicon 工具页均支持中文/英文文案。
- 静态部署：Web 项目使用 Next.js 静态导出，适合部署到 Cloudflare Pages。
- Worker 服务：集中承载 API、OAuth、D1、WebSocket 信令、Durable Object 和对象存储协调。

## 项目结构

```text
.
├── apps/
│   ├── web/                       # Next.js + React Web 应用
│   └── desktop/                   # Tauri Desktop 应用
├── packages/
│   ├── ui/                        # Workspace、协作和共享 UI
│   ├── shared/                    # 共享类型、工具和协议
│   └── wasm/                      # WASM Web 包与浏览器编码器
├── crates/
│   ├── picbind-core/              # 跨平台领域逻辑
│   ├── picbind-image/             # Rust WASM 图片处理库
│   ├── picbind-network/           # WebSocket、WebRTC、信令和传输
│   ├── picbind-perceptual/        # 感知质量 Rust WASM 库
│   ├── picbind-protocol/          # 跨端稳定协议类型
│   └── picbind-storage/           # 本地、缓存和数据库抽象
├── services/
│   └── cloudflare-worker/         # API、OAuth、信令和实时 Worker
├── docs/
│   ├── architecture/
│   ├── protocol/
│   └── product/
├── Cargo.toml
└── pnpm-workspace.yaml
```

Web 端持久化文件统一写入 OPFS，SQLite 仅保存业务元数据和评审历史，页面通过
Repository 访问数据。语言、房间会话和页面恢复等短期状态仍使用
`localStorage/sessionStorage`。

## Web 应用

Web 应用位于 `apps/web/`，主要页面包括：

- `/`：图片压缩首页。
- `/favicon-converter`：从图片生成 favicon。
- `/favicon-generator`：从文字生成 favicon。
- `/admin`：读取和维护 Worker 中的统计与站点配置。

常用命令：

```bash
pnpm install
pnpm dev:web
pnpm build:web
```

构建输出会生成到 `apps/web/out/`，可作为 Cloudflare Pages 的静态产物目录。

## Tauri 桌面客户端

Tauri 客户端位于 `apps/desktop/`，当前版本为 `0.1.0`。界面复用现有 Web 前端，
微信 iLink Bot 的凭据、长轮询和媒体处理仅在 Desktop 本地运行。从仓库根目录运行：

```bash
pnpm dev:desktop
```

该命令会启动现有 Web 开发服务并打开 PicBind 桌面窗口。详细环境和检查命令见
`docs/architecture/desktop/development.md`。

## 本地 Desktop 开发

macOS、Linux、Git Bash 和 WSL 下的脚本会显示阻塞式菜单，可以选择启动 Tauri
Desktop 开发环境、构建 Desktop 生产版本，或者仅启动 Web 开发服务。Desktop 开发
模式下由根目录进程管理器同时启动并跟踪 Tauri 和唯一的 Web 服务；任何一方停止时，
另一方及其子进程也会被回收。Room、Durable Object、R2、KV 和其他 Worker API 统一
请求已部署的 `https://api.picbind.com`。从仓库根目录运行：

```bash
# macOS / Linux / Git Bash / WSL
./dev-local.sh

# Windows CMD
dev-local.cmd

# Windows PowerShell
.\dev-local.cmd
```

选择 Desktop development 后，Desktop 会加载
`http://localhost:3000/tauri-dev.html`。所选任务会一直占用当前终端；按 `Ctrl+C` 会
同时停止 Tauri 和 Web 进程，不会遗留 `3000` 端口。修改 Worker 后必须部署到
Cloudflare，应用才会使用到新实现。

## WASM 构建

Rust WASM 代码位于 `crates/picbind-image/`。修改 Rust 图片处理逻辑后，需要重新构建 WASM：

```bash
cd packages/wasm
npm run build
```

也可以单独执行 `npm run build:image` 或 `npm run build:perceptual`。

生成文件会输出到：

```text
packages/wasm/image-wasm/
packages/wasm/perceptual-wasm/
```

## Rustup 国内镜像

项目提供 `scripts/rustup-cn.sh`，默认使用 `rsproxy.cn` 下载 Rust 工具链。执行单条
命令时可以直接通过包装脚本调用：

```bash
bash scripts/rustup-cn.sh toolchain install stable
bash scripts/rustup-cn.sh target add wasm32-unknown-unknown
```

如果希望当前 Bash 会话中的后续 `rustup` 命令都使用该镜像，可以先加载环境变量：

```bash
source scripts/rustup-cn.sh
rustup show
```

PowerShell 可以使用等价配置：

```powershell
$env:RUSTUP_DIST_SERVER = "https://rsproxy.cn"
$env:RUSTUP_UPDATE_ROOT = "https://rsproxy.cn/rustup"
rustup show
```

如果环境变量已经设置为其他镜像，脚本会保留现有值。

## Cloudflare Pages 部署

当前 Web 侧已移除 Next 内置 API 路由和 Docker 部署配置，适合按静态站点部署到 Cloudflare Pages。

推荐配置：

```text
Build command: pnpm install --frozen-lockfile && pnpm build:web
Build output directory: apps/web/out
```

如果 Cloudflare Pages 的项目根目录直接设置为 `apps/web/`，则可以使用：

```text
Build command: pnpm install --frozen-lockfile && pnpm build
Build output directory: out
```

## Cloudflare Worker API

Worker 服务位于 `services/cloudflare-worker/`，用于替代旧的 Next API 路由。

Cloudflare Git 部署必须使用以下设置：

```text
Root directory: services/cloudflare-worker
Deploy command: npx wrangler deploy
Configuration file: wrangler.toml
```

不要在仓库根目录生成 `wrangler.jsonc`。从仓库根目录执行自动配置会把
整个项目误部署为静态 Assets Worker，并覆盖同名的 API Worker。

当前 Worker 兼容这些接口：

```text
GET  /api/metrics
POST /api/metrics
POST /api/site/view
GET  /api/admin/state?key=...
POST /api/admin/state?key=...
POST /api/seo/baidu/push?key=...
POST /api/realtime/room/create
```

Worker 使用 Cloudflare KV 保存统计和页面配置。需要绑定：

```text
METRICS_KV
```

可选环境变量：

```text
ADMIN_KEY
SITE_URL
ALLOWED_ORIGINS
BAIDU_PUSH_SITE
BAIDU_PUSH_TOKEN
```

前端当前默认不请求统计 API。Worker 部署完成后，可在 Pages 环境变量中开启：

```text
NEXT_PUBLIC_METRICS_ENABLED=true
NEXT_PUBLIC_METRICS_API_PATH=https://api.picbind.com/api/metrics
NEXT_PUBLIC_PAGE_VIEW_ENABLED=true
NEXT_PUBLIC_PAGE_VIEW_API_PATH=https://api.picbind.com/api/site/view
NEXT_PUBLIC_ADMIN_STATE_API_PATH=https://api.picbind.com/api/admin/state
```

推荐的 Worker 环境变量：

```text
SITE_URL=https://picbind.com
ALLOWED_ORIGINS=https://picbind.com,https://www.picbind.com
BAIDU_PUSH_SITE=https://picbind.com
ADMIN_KEY=<your-admin-key>
BAIDU_PUSH_TOKEN=<your-baidu-token>
```

## Favicon 资源

网站自己的 favicon 资源统一放在：

```text
apps/web/public/images/favicon/
```

包括：

```text
favicon.ico
favicon-16x16.png
favicon-32x32.png
apple-touch-icon.png
android-chrome-192x192.png
android-chrome-512x512.png
site.webmanifest
```

## 设计原则

- 图片处理优先在浏览器本地完成。
- WASM 承担重计算和图像编码逻辑。
- 前端页面保持可静态导出，减少部署复杂度。
- 动态统计和管理能力迁移到 Cloudflare Worker。

## 高清图片下载
https://www.pexels.com/
选好图图片以后，在图片上右键 Copy Image link，拿到连接以后再地址栏中拷贝链接，然后在末尾加上?auto=compress&fm=webp&w=1920
