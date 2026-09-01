# PicBind Tauri 本地开发说明

> Tauri 版本：0.1.0
> Web 版本：1.0.8
> 文档状态：Tauri 运行与 Native Store 初始化已验证

## 1. 工程位置

Tauri 客户端位于仓库根目录的 `apps/desktop/`：

```text
apps/desktop/
├── package.json
├── pnpm-lock.yaml
└── src-tauri/
    ├── Cargo.toml
    ├── Cargo.lock
    ├── build.rs
    ├── capabilities/
    │   └── default.json
    ├── src/
    │   ├── download/
    │   │   ├── commands.rs
    │   │   └── mod.rs
    │   ├── lib.rs
    │   ├── main.rs
    │   └── storage/
    │       ├── commands.rs
    │       ├── database.rs
    │       ├── files.rs
    │       └── mod.rs
    └── tauri.conf.json
```

客户端不包含独立业务页面。开发模式由根进程管理器复用或启动 `apps/web/` 的 Next.js 开发
服务，确认 `http://localhost:3000/tauri-dev.html` 可访问后再启动 Tauri；WebView 通过该页面
等待首页及其脚本完成编译，再进入现有 Web 首页。

## 2. 环境要求

本阶段已在以下环境验证：

- macOS（Apple Silicon）
- Node.js 24.16.0
- pnpm 11.10.0
- Rust 1.98.0 stable
- Xcode Command Line Tools

Windows 和 Linux 尚未验证，不应标记为已支持。

## 3. 首次安装

Web 与桌面工程使用统一的根依赖工作区：

```bash
cd <repository-root>
pnpm install
```

Rust crate 会在首次检查或启动时由 Cargo 下载。

## 4. 启动客户端

从仓库根目录执行：

```bash
pnpm dev:desktop
```

该命令会依次执行：

1. 检查 `http://localhost:3000`；端口已占用时复用现有 Web 开发服务，否则启动一个新服务。
2. 等待 `http://localhost:3000/tauri-dev.html` 可访问，避免 Tauri 自己进入 dev server 轮询。
3. 编译 Tauri Rust 工程并启动 PicBind 桌面窗口，由开发启动页确认 Next.js 首页及脚本可用。

首次启动需要编译 Tauri 及其 Rust 依赖，耗时会明显高于后续启动。按 `Ctrl+C` 可
停止 Tauri 客户端和本次命令启动的 Web 开发服务；复用的已有 Web 服务不会被停止。

客户端启动时不会自动打开 Web Inspector。debug 模式下可按 `Command + Option + I`
手动切换；`capabilities/default.json` 仅为 `main` 窗口授予
`core:webview:allow-internal-toggle-devtools` 权限。

## 5. 检查命令

检查 Rust/Tauri 工程：

```bash
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
```

检查 Web 静态构建：

```bash
pnpm build:web
```

第一阶段不要求生成签名安装包，也不包含自动更新和发布流程。

## 6. 关键配置

`apps/desktop/src-tauri/tauri.conf.json` 当前配置为：

- Tauri 产品版本：`0.1.0`
- 开发启动页：`http://localhost:3000/tauri-dev.html`
- Web 开发命令：由根进程管理器执行 `pnpm --dir apps/web dev`
- Web 构建命令：`pnpm --dir ../web build`
- 静态输出目录：`apps/web/out`
- 应用标识：`com.picbind.desktop`
- 主窗口 capability：`core:default`、`core:webview:allow-internal-toggle-devtools`、
  `websocket:default`、`picbind-realtime:default`，仅授予 `main` window
- 下载方式：Web 使用浏览器下载；Tauri 使用原生保存对话框和 Rust 二进制写入
- OAuth 回调：使用 `http://127.0.0.1:<random-port>/picbind/oauth/callback`
- 单实例：使用 `tauri-plugin-single-instance` 防止重复启动应用

桌面图标直接复用 `apps/web/public/images/favicon/android-chrome-512x512.png`。

Native Store 启动后会在 Tauri 返回的应用数据目录内创建 `database/`、`assets/`、
`derived/`、`cache/` 和 `temp/`。本机验证已确认 `database/picbind.sqlite` 创建成功且
schema 为 V2；业务代码不得硬编码本机绝对路径。

### 6.1 桌面 OAuth 回调

Google/GitHub 登录继续在系统浏览器完成，Provider 的 HTTPS callback 仍指向 Worker。
Desktop Rust 在每次授权前绑定一个随机 IPv4 loopback 端口，并传入以下返回地址：

```text
http://127.0.0.1:<random-port>/picbind/oauth/callback
```

Worker 完成 Provider code 兑换后，将浏览器重定向到该地址，并只携带 60 秒有效且只能
使用一次的 Handoff Code，不携带 Session Token。Rust 校验 callback 的 method、host、
端口和 path，再以同一个 `http://127.0.0.1:<random-port>` origin 调用 Worker 的
`POST /api/auth/exchange`，最后将用户资料直接返回给 WebView。开发版和正式包、macOS、
Windows 与 Linux 均使用相同流程，也不注册自定义 URL scheme。

### 6.2 Desktop Realtime

Workspace 实时协作通过应用组合根选择 transport：

- WebSocket 使用 `@tauri-apps/plugin-websocket`，Text/Binary 转换和有界异步 FIFO 位于
  `apps/web/src/realtime/adapters/tauri-socket.ts`。
- WebRTC 使用 `crates/picbind-network` 的 Rust `webrtc = 0.14.0` 实现，通过
  `picbind-realtime` Tauri plugin 暴露 Peer commands 和 raw binary event channel。
- 公共层 Binary 始终是 `ArrayBuffer`；Native RTC 正式路径不使用 Base64。
- RTC 晋升后 WebSocket 仍保持在线，承担信令、成员状态和可靠回退。
- RTC 失败时只回退 Tauri WebSocket，不创建 WebView `RTCPeerConnection`。
- 主窗口销毁或应用退出时，plugin 会 drain 并关闭所有 Native Peer。

当前只通过 macOS 编译、契约和单元测试。真实 TURN、Web-Desktop/Desktop-Desktop 互操作、
Native bulk IPC 性能与内存、Windows 和 Linux 尚未验证。

## 7. 当前限制

- Tauri 仍复用现有 Web UI，但图片缓存已经使用 Rust Native Store。
- 单图、ZIP、Workspace 图片和 favicon ZIP 通过统一 Download Repository 分流；Tauri 不依赖
  WKWebView 的 Blob `<a download>`。
- 没有原生文件选择、菜单、托盘、通知或 Shell 权限。
- Web/Tauri 的存储、图片处理和 realtime 差异只允许位于各自平台 Adapter；运行环境由应用
  组合层选择，不进入 Workspace 页面组件和业务 Store。
- 压缩图、Workspace 和消息图片已使用分页元数据与按需 Blob 读取；兼容接口仍可显式恢复
  完整列表。
- 当前开发阶段不迁移旧 Dexie + OPFS 图片缓存；存储结构调整后直接清理开发缓存。
- 消息缓存与派生缩略图使用 512 MB / 30 天 LRU，启动时执行 temp、孤儿和缺失记录恢复。
- 未验证正式安装包、签名、自动更新、Windows 和 Linux。
- Web 静态资源由 Next.js 导出，Cloudflare Pages 响应头由 `apps/web/public/_headers` 管理。

## 8. 常见问题

### 端口被占用

Tauri 开发模式固定使用 3000 端口。如果该端口已有开发服务，应直接复用
`http://localhost:3000`，不要终止、替换或重复启动该服务。根进程管理器会自动执行该检查；
只有 `/tauri-dev.html` 可访问后才会启动 Tauri，因此正常启动不再显示持续等待 frontend dev
server 的提示。若等待超时，直接检查现有 3000 服务是否来自本仓库且能访问该路径。

### 首次启动较慢

首次执行会下载并编译 Tauri Rust 依赖。后续启动会使用 Cargo 缓存。

### 窗口显示空白页

Tauri 开发模式通过 `apps/web/public/tauri-dev.html` 等待 Next.js 首页及脚本编译完成，避免
WKWebView 在冷启动编译期间因 chunk 请求超时而显示空白页。若仍为空白，先检查终端中
Next.js 是否已显示 `Ready`，再确认访问 `http://localhost:3000` 能返回页面，并通过
`Command + Option + I` 检查实际运行时错误。
