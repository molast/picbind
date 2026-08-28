# PicBind Repository Structure

PicBind 使用应用、可复用包、Rust crate、服务和文档五个顶层边界。新功能必须先确定
所有权，再进入对应目录，不能重新创建旧的 `web/`、`desktop/`、`sdk/`、`wasm/`
或根级 `cloudflare-worker/` 目录。

## Applications

- `apps/web`：Next.js + React 浏览器应用。App Router 路由位于 `src/app`，应用级状态
  位于 `src/stores`，页面可复用组件位于 `src/components`。
- `apps/desktop`：Tauri 应用。为遵循 Tauri CLI 约定，Rust、capability 和
  `tauri.conf.json` 保留在 `apps/desktop/src-tauri`；前端始终复用 `apps/web`。

## Packages

- `packages/ui`：可复用 UI、Image Workspace、平台无关 Realtime Session Core、协作、消息和
  浏览器存储适配；业务页面通过 `RealtimeProvider` 使用注入的 transport。
- `packages/shared`：跨应用共享的 TypeScript 类型、常量、工具、图片处理与 Realtime ports、
  稳定错误、FIFO 和阈值。
- `packages/wasm`：Rust WASM 的 Web 产物和 WebP / AVIF 浏览器编码适配层。

包之间只通过公开 export 依赖。应用可以导入包，包不能反向导入应用源码。

## Rust Crates

- `crates/picbind-core`：Workspace、用户、协作、图片和任务领域逻辑。
- `crates/picbind-image`：图片分析、编码、压缩、格式处理和共享图片 metadata。
- `crates/picbind-image-native`：Desktop Native JPEG、PNG、WebP、AVIF 编解码和压缩。
- `crates/picbind-network`：Desktop Native WebRTC、DataChannel、信令模型、多 Peer 路由、
  Tauri Realtime bridge、生命周期和官方 WebSocket plugin 注册入口。`native-webrtc` 与 `tauri`
  features 控制平台依赖。
- `crates/picbind-perceptual`：Butteraugli 感知质量计算。
- `crates/picbind-protocol`：Workspace、协作、传输和事件的稳定协议类型。
- `crates/picbind-storage`：本地文件、缓存和数据库存储抽象。

这些 crate 必须保持职责单一，并通过公开接口建立依赖。所有 crate 由根 `Cargo.toml` 管理。

## Services

- `services/cloudflare-worker`：Cloudflare 上的 API、OAuth、D1、Workspace Realtime V2
  WebSocket 信令、TURN credential、Durable Object 和 OAuth 头像对象存储。Worker 不保存
  Workspace 协作图片内容。

如果未来 API、信令或其他后端需要独立部署，再拆为 `services/api`、
`services/signaling` 等独立服务；当前不复制 Worker 内已有逻辑。

## Documents

- `docs/architecture`：仓库、Desktop、存储和实现架构。
- `docs/protocol`：稳定的跨端协议说明。
- `docs/product`：产品需求、Workspace 计划、测试案例和压缩行为说明。

## Workspace Commands

依赖从仓库根目录统一安装：

```bash
pnpm install
pnpm build:web
pnpm check:ui
pnpm check:worker
cargo test --workspace
```

本地开发仍通过根 `dev-local.sh` 或 `dev-local.mjs` 管理 Web 与 Desktop 进程，禁止在
Tauri 配置中重新加入隐式 Web 启动命令。
