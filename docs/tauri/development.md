# PicBind Tauri 本地开发说明

> Tauri 版本：0.1.0
> Web 版本：1.0.8
> 文档状态：第一阶段已验证

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
    ├── src/
    │   ├── lib.rs
    │   └── main.rs
    └── tauri.conf.json
```

客户端不包含独立页面。开发模式由 Tauri 启动 `web/` 的 Next.js 开发服务，并在
桌面窗口中加载 `http://localhost:3000`。

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
3. 启动 PicBind 桌面窗口并加载现有 Web 首页。

首次启动需要编译 Tauri 及其 Rust 依赖，耗时会明显高于后续启动。按 `Ctrl+C` 可
同时停止 Tauri 客户端和由其启动的 Web 开发服务。

## 5. 检查命令

检查 Rust/Tauri 工程：

```bash
cd desktop
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --locked --manifest-path src-tauri/Cargo.toml
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
- 开发服务：`http://localhost:3000`
- Web 开发命令：`pnpm --dir ../web dev`
- Web 构建命令：`pnpm --dir ../web build`
- 静态输出目录：`web/out`
- 应用标识：`com.picbind.desktop`

桌面图标直接复用 `web/public/images/favicon/android-chrome-512x512.png`。

## 7. 第一阶段限制

- Tauri 仅作为现有 Web 应用的桌面运行容器。
- 没有原生文件、菜单、托盘、通知或 Shell 权限。
- 没有 Web/Tauri 条件分支或桌面专属业务逻辑。
- 未验证正式安装包、签名、自动更新、Windows 和 Linux。
- Web 静态导出仍可能显示现有的 Next.js `headers` 提示，该提示并非 Tauri 接入新增。

## 8. 常见问题

### 端口被占用

Tauri 开发模式固定使用 3000 端口。启动前需停止其他占用该端口的开发服务。

### 首次启动较慢

首次执行会下载并编译 Tauri Rust 依赖。后续启动会使用 Cargo 缓存。

### 窗口显示空白页

先检查终端中 Next.js 是否已显示 `Ready`，再确认访问 `http://localhost:3000` 能返回
页面。不要通过增加平台判断或修改 Web 业务逻辑来绕过启动问题。
