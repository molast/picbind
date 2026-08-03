# PicBind

PicBind 是一个基于 Rust WASM 和 Next.js 的在线图片工具站。当前重点功能是浏览器端图片压缩和 favicon 生成，图片处理尽量在本地完成，减少服务端依赖，方便部署到 Cloudflare Pages。

## 当前功能

- 图片压缩：支持 PNG、JPEG、WebP、AVIF，支持批量上传、自动压缩、单文件下载和 ZIP 打包下载。
- 压缩质量分析：在浏览器 Worker 中分析压缩前后的质量指标，用于辅助判断输出效果。
- Favicon Converter：上传图片生成 favicon 图标包。
- Favicon Generator：通过文字、Google Fonts 字体、字重、颜色和背景形状生成 favicon 图标包。
- Favicon 打包：生成 `favicon.ico`、16/32 PNG、Apple touch icon、Android chrome icon 和 `site.webmanifest`。
- 中英文切换：首页和 favicon 工具页均支持中文/英文文案。
- 静态部署：Web 项目已配置为 `next export` 风格输出，适合部署到 Cloudflare Pages。
- Worker API 骨架：统计、访问量、后台配置、百度推送接口已迁移到独立 Cloudflare Worker 目录。

## 项目结构

```text
.
├── cloudflare-worker/      # Cloudflare Worker API 服务骨架
├── sdk/                    # 可独立构建和复用的前端 SDK
│   ├── wasm/               # 可复用的 WASM Web SDK
│   │   ├── image-wasm/     # 图片处理 WASM Web 产物
│   │   └── perceptual-wasm/ # 感知质量 WASM Web 产物
│   ├── mip/                # Motion Intent Protocol SDK
│   └── room/               # Room SDK 与独立 Demo
├── wasm/image_wasm/        # Rust WASM 图片处理库
└── web/                    # Next.js 前端应用（SQLite WASM + OPFS 本地存储）
```

Web 端持久化文件统一写入 OPFS，SQLite 仅保存业务元数据和评审历史，页面通过
Repository 访问数据。语言、房间会话和页面恢复等短期状态仍使用
`localStorage/sessionStorage`。

## Web 应用

Web 应用位于 `web/`，主要页面包括：

- `/`：图片压缩首页。
- `/favicon-converter`：从图片生成 favicon。
- `/favicon-generator`：从文字生成 favicon。
- `/admin`：当前为静态占位页，后台接口后续由 Worker 接入。

常用命令：

```bash
cd web
npm install
npm run dev
npm run build
```

构建输出会生成到 `web/out/`，可作为 Cloudflare Pages 的静态产物目录。

## 完全本地开发

本地开发不会请求已部署的 `api.picbind.com`，房间 API、Durable Object、
KV 和 WebSocket 信令都由本机运行时模拟，房间文件默认通过 P2P 传输。

启动脚本会检查本地 API 依赖，缺少依赖命令时会自动执行
`pnpm install --frozen-lockfile`。从仓库根目录运行：

```bash
# macOS / Linux / Git Bash / WSL
./dev-local.sh

# Windows CMD
dev-local.cmd

# Windows PowerShell
.\dev-local.cmd
```

前端地址为 `http://localhost:3000`，本地 API 地址为
`http://127.0.0.1:8787`。按 `Ctrl+C` 会同时停止两个进程，不会残留 API
端口。本地房间和状态保存在 `cloudflare-worker/.wrangler/state`。

## WASM 构建

Rust WASM 代码位于 `wasm/image_wasm/`。修改 Rust 图片处理逻辑后，需要重新构建 WASM：

```bash
cd sdk/wasm
npm run build
```

也可以单独执行 `npm run build:image` 或 `npm run build:perceptual`。

生成文件会输出到：

```text
sdk/wasm/image-wasm/
sdk/wasm/perceptual-wasm/
```

## Cloudflare Pages 部署

当前 Web 侧已移除 Next 内置 API 路由和 Docker 部署配置，适合按静态站点部署到 Cloudflare Pages。

推荐配置：

```text
Build command: cd web && npm install && npm run build
Build output directory: web/out
```

如果 Cloudflare Pages 的项目根目录直接设置为 `web/`，则可以使用：

```text
Build command: npm install && npm run build
Build output directory: out
```

## Cloudflare Worker API

Worker 服务位于 `cloudflare-worker/`，用于替代旧的 Next API 路由。

Cloudflare Git 部署必须使用以下设置：

```text
Root directory: cloudflare-worker
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
web/public/images/favicon/
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
