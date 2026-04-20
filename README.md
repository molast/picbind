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
├── wasm/image_wasm/        # Rust WASM 图片处理库
└── web/                    # Next.js 前端应用
```

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

## WASM 构建

Rust WASM 代码位于 `wasm/image_wasm/`。修改 Rust 图片处理逻辑后，需要重新构建 WASM：

```bash
cd web
npm run wasm:build
```

生成文件会输出到：

```text
web/public/wasm/
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

当前 Worker 兼容这些接口：

```text
GET  /api/metrics
POST /api/metrics
POST /api/site/view
GET  /api/admin/state?key=...
POST /api/admin/state?key=...
POST /api/seo/baidu/push?key=...
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
- 不再使用 Docker 部署。
