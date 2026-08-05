# PicBind Tauri 本地开发说明

> Tauri 版本：0.1.0
> Web 版本：1.0.8
> 文档状态：Tauri 运行与 Native Store 初始化已验证

## 1. 工程位置

Tauri 客户端位于仓库根目录的 `desktop/`：

```text
desktop/
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

客户端不包含独立业务页面。开发模式由 Tauri 启动 `web/` 的 Next.js 开发服务，先加载
`http://localhost:3000/tauri-dev.html` 等待首页及其脚本完成编译，再进入现有 Web 首页。

## 2. 环境要求

本阶段已在以下环境验证：

- macOS（Apple Silicon）
- Node.js 24.16.0
- pnpm 11.10.0
- Rust 1.93.0 stable
- Xcode Command Line Tools

Windows 和 Linux 尚未验证，不应标记为已支持。

## 3. 首次安装

Web 与桌面工程分别安装依赖：

```bash
cd web
pnpm install

cd ../desktop
pnpm install
```

Rust crate 会在首次检查或启动时由 Cargo 下载。

## 4. 启动客户端

从仓库根目录执行：

```bash
cd desktop
pnpm dev
```

该命令会依次执行：

1. 启动现有 Web 开发服务，监听 `http://localhost:3000`。
2. 编译 Tauri Rust 工程。
3. 启动 PicBind 桌面窗口，通过开发启动页确认 Next.js 资源可用后加载现有 Web 首页。

首次启动需要编译 Tauri 及其 Rust 依赖，耗时会明显高于后续启动。按 `Ctrl+C` 可
同时停止 Tauri 客户端和由其启动的 Web 开发服务。

客户端启动时不会自动打开 Web Inspector。debug 模式下可按 `Command + Option + I`
手动切换；`capabilities/default.json` 仅为 `main` 窗口授予
`core:webview:allow-internal-toggle-devtools` 权限。

## 5. 检查命令

检查 Rust/Tauri 工程：

```bash
cd desktop
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

检查 Web 静态构建：

```bash
cd web
pnpm build
```

第一阶段不要求生成签名安装包，也不包含自动更新和发布流程。

## 6. 关键配置

`desktop/src-tauri/tauri.conf.json` 当前配置为：

- Tauri 产品版本：`0.1.0`
- 开发启动页：`http://localhost:3000/tauri-dev.html`
- Web 开发命令：`pnpm --dir ../web dev`
- Web 构建命令：`pnpm --dir ../web build`
- 静态输出目录：`web/out`
- 应用标识：`com.picbind.desktop`
- 主窗口 capability：`core:default`、`core:webview:allow-internal-toggle-devtools`
- 下载方式：Web 使用浏览器下载；Tauri 使用原生保存对话框和 Rust 二进制写入

桌面图标直接复用 `web/public/images/favicon/android-chrome-512x512.png`。

Native Store 启动后会在 Tauri 返回的应用数据目录内创建 `database/`、`assets/`、
`derived/`、`cache/` 和 `temp/`。本机验证已确认 `database/picbind.sqlite` 创建成功且
schema 为 V2；业务代码不得硬编码本机绝对路径。

## 7. 当前限制

- Tauri 仍复用现有 Web UI，但图片缓存已经使用 Rust Native Store。
- 单图、ZIP、Room 图片和 favicon ZIP 通过统一 Download Repository 分流；Tauri 不依赖
  WKWebView 的 Blob `<a download>`。
- 没有原生文件选择、菜单、托盘、通知或 Shell 权限。
- Web/Tauri 差异只允许位于 `ImageStorageRepository` 的两个平台实现中；运行环境由统一
  selector 选择一次，不进入业务 Repository、页面组件和业务 Store。
- 压缩图、Room 和消息图片已使用分页元数据与按需 Blob 读取；兼容接口仍可显式恢复
  完整列表。
- 当前开发阶段不迁移旧 Dexie + OPFS 图片缓存；存储结构调整后直接清理开发缓存。
- 消息缓存与派生缩略图使用 512 MB / 30 天 LRU，启动时执行 temp、孤儿和缺失记录恢复。
- 未验证正式安装包、签名、自动更新、Windows 和 Linux。
- Web 静态导出仍可能显示现有的 Next.js `headers` 提示，该提示并非 Tauri 接入新增。

## 8. 常见问题

### 端口被占用

Tauri 开发模式固定使用 3000 端口。启动前需停止其他占用该端口的开发服务。

### 首次启动较慢

首次执行会下载并编译 Tauri Rust 依赖。后续启动会使用 Cargo 缓存。

### 窗口显示空白页

Tauri 开发模式通过 `web/public/tauri-dev.html` 等待 Next.js 首页及脚本编译完成，避免
WKWebView 在冷启动编译期间因 chunk 请求超时而显示空白页。若仍为空白，先检查终端中
Next.js 是否已显示 `Ready`，再确认访问 `http://localhost:3000` 能返回页面，并通过
`Command + Option + I` 检查实际运行时错误。
