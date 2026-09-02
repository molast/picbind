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
│   ├── picbind-image-native/      # Desktop Native 图片编解码库
│   ├── picbind-network/           # WebSocket、WebRTC、信令和传输
│   ├── picbind-perceptual/        # 感知质量 Rust WASM 库
│   ├── picbind-protocol/          # 跨端稳定协议类型
│   └── picbind-storage/           # 本地、缓存和数据库抽象
├── services/
│   └── cloudflare-worker/         # API、OAuth、信令和实时 Worker
├── Cargo.toml
└── pnpm-workspace.yaml
```

Web 端持久化文件统一写入 OPFS，SQLite 仅保存业务元数据和评审历史，页面通过
Repository 访问数据。语言、工作区会话和页面恢复等短期状态仍使用
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

该命令会复用 3000 端口已有的 Web 开发服务，或在端口空闲时启动服务，然后打开 PicBind
桌面窗口。

## 本地 Desktop 开发

macOS、Linux、Git Bash 和 WSL 下的脚本会显示阻塞式菜单，可以选择启动 Tauri
Desktop 开发环境、仅启动 Desktop app、构建 Desktop 生产版本，或者仅启动 Web 开发服务。Desktop 开发
模式下由根目录进程管理器复用 3000 端口已有的 Web 服务，或启动并跟踪唯一的 Web 服务；
确认开发启动页可访问后才启动 Tauri。任何受管理进程停止时，其余受管理进程及子进程会被
回收，复用的外部 Web 服务不会被停止。Workspace、Durable Object、R2、KV 和其他 Worker API 统一
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
停止 Tauri 和本次命令启动的 Web 进程，不会停止复用的已有服务。修改 Worker 后必须部署到
Cloudflare，应用才会使用到新实现。

选择 `Desktop app only (requires Web on :3000)` 或运行 `pnpm dev:desktop-only` 时，只会
启动 Tauri Desktop app，不会启动、重启或替换 Web 服务。该模式要求 3000 端口已有本仓库的
Web app，若服务不存在或 `/tauri-dev.html` 不可访问则直接退出。

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

如需使用国内镜像，请在本机 shell 配置中设置全局环境变量。例如 Bash 或 Zsh：

```bash
export RUSTUP_DIST_SERVER="https://rsproxy.cn"
export RUSTUP_UPDATE_ROOT="https://rsproxy.cn/rustup"
```

重新打开终端后即可直接使用 `rustup`：

```bash
rustup show
```

PowerShell 可以使用等价配置：

```powershell
$env:RUSTUP_DIST_SERVER = "https://rsproxy.cn"
$env:RUSTUP_UPDATE_ROOT = "https://rsproxy.cn/rustup"
rustup show
```

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
POST /api/workspaces
POST /api/workspace-links/:shareId/realtime-ticket
POST /api/workspaces/:workspaceId/realtime-ticket
GET  /api/workspaces/:workspaceId/realtime-v2
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
