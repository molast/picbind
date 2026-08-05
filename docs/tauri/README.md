# PicBind Tauri 改版说明

> 产品版本：0.1.0
> 文档状态：第一阶段已完成，图片 Native Store 基础层已接入
> 适用范围：PicBind Tauri 桌面版

## 1. 文档目的

本文档用于定义 PicBind Tauri 改版第一阶段的目标和验收边界。Tauri 桌面版从
`0.1.0` 开始独立管理版本。第一阶段直接复用现有 Web 前端；图片存储通过统一接口和
运行时 selector 选择独立实现，Web 使用 Dexie + OPFS，Tauri 使用 SQLite + 应用数据目录。

Tauri 工程位于 `desktop/`，本地开发和验证方式见 `docs/tauri/development.md`，图片
存储的当前实现和后续边界见 `docs/tauri/tauri-storage-architecture-v2.md`。

## 2. 版本边界

| 产品形态 | 当前版本 | 说明 |
| --- | --- | --- |
| Tauri 桌面版 | `0.1.0` | Tauri 改版后的首个桌面版本 |
| Web 版 | `1.0.8` | 继续使用现有版本，不因 Tauri 改版变更 |

两个产品形态分别维护版本号。Tauri 桌面版的版本升级不得自动修改
`web/package.json`，Web 版发版也不得自动修改 Tauri 桌面版版本。

## 3. 第一阶段目标

第一阶段已完成 Tauri 框架接入和本地 PC 客户端运行验证：

- 建立 Tauri 基础工程。
- 直接复用现有 Web 前端作为 Tauri 窗口内容。
- 提供本地开发启动方式。
- 在本地 PC 上成功启动客户端。
- 在客户端窗口中正常显示和操作现有 Web 页面。

本阶段的核心是验证“现有 Web 应用可以在 Tauri 客户端中正常运行”。现有页面、
功能、交互、数据处理和网络请求方式保持不变。

## 4. `0.1.0` 版本范围

`0.1.0` 第一阶段只包含以下工作：

1. 建立独立的 Tauri 应用目录和基础配置。
2. 将 Tauri 应用版本设置为 `0.1.0`。
3. 接入现有 Web 前端，不复制页面和业务代码。
4. 配置 Tauri 本地开发启动流程。
5. 在本地 PC 上启动 Tauri 窗口并完成运行验证。

### 4.1 本阶段非目标

第一阶段明确不包含：

- 不新增桌面端专属页面、交互或业务功能。
- 不根据 Web 或 Tauri 运行环境执行不同业务逻辑。
- 不接入原生文件选择、文件保存或目录访问。
- 不接入桌面菜单、系统托盘、快捷键或系统通知。
- 不修改现有图片压缩算法、格式支持或质量策略。
- 不调整现有 Web 页面的数据存储和网络请求方式。
- 不要求完成安装包签名、自动更新或正式发布流程。

上述能力如需实施，应在第一阶段完成后单独定义范围和版本。

## 5. 与 Web 版的关系

### 5.1 前端复用方式

本阶段直接复用现有 Web 前端及其依赖的全部业务能力，包括：

- 页面、组件和样式。
- 图片压缩和格式处理流程。
- Rust/WASM 图片处理能力。
- 本地数据存储方式。
- 现有网络请求和 Room 能力。

Tauri 只提供桌面窗口和运行容器，不创建另一套前端实现。

### 5.2 Tauri 独立内容

第一阶段仅独立维护 Tauri 工程运行所必需的内容：

- Tauri 配置和 Rust 启动入口。
- 客户端名称、窗口基础配置和 `0.1.0` 版本信息。
- 本地开发启动所需的命令和说明。

除 Tauri 框架运行所必需的配置外，不增加桌面专用业务代码。

### 5.3 隔离规则

- Tauri 桌面版不得修改 Web 版版本号。
- Web 版不得依赖 Tauri 进程才能运行；Tauri API 客户端只能由 Tauri Repository 调用。
- Web 版继续保持当前静态构建和 Cloudflare Pages 部署方式。
- 页面组件、业务 Store 和业务 Repository 不判断当前运行于 Web 还是 Tauri；统一 selector
  只选择一次 `WebImageStorageRepository` 或 `TauriImageStorageRepository`。
- 下载通过统一 `DownloadRepository` 分流：Web 使用浏览器下载，Tauri 使用原生保存对话框。
- Tauri 客户端与 Web 版使用相同的前端功能和处理流程。

## 6. 第一阶段实施约束

- Tauri 桌面版版本固定为 `0.1.0`。
- Web 版继续保持 `1.0.8`，不修改其版本和发布流程。
- Tauri 直接运行现有 Web 前端，不复制或分叉页面、业务及压缩代码。
- 第一阶段不添加 Web 与 Tauri 的条件分支；后续已确认的图片存储差异只位于
  Repository 适配层。
- 接入 Tauri 时不得改变现有 Web 构建结果和线上部署流程。
- 如果实施过程中必须修改图片压缩行为，则该改动超出本阶段范围，需要单独确认，
  并同步更新 `docs/prd/collaboration/COMPRESSION_ALGORITHM.md`。

## 7. `0.1.0` 第一阶段完成标准

第一阶段已经满足以下完成条件：

- Tauri 工程具有一致的 `0.1.0` 版本信息。
- 仓库提供明确可执行的 Tauri 本地开发启动命令。
- 本地 PC 能够成功启动 Tauri 客户端窗口。
- 客户端能够正常加载现有 Web 前端，不出现空白页或启动错误。
- 现有 Web 页面和主要操作在 Tauri 窗口中可以正常使用。
- 页面组件和业务 Store 不包含针对 Web 或 Tauri 的差异化处理。
- Tauri 专用代码不会改变 Web 版构建结果及其 `1.0.8` 版本。

## 8. 后续文档

当前 Tauri 文档包括：

```text
docs/tauri/
├── README.md                 # 版本入口与阶段边界
├── AI_CODING_GUIDELINES.md   # 后续 AI Coding 实施规范
├── development.md            # 已验证的本地开发和构建说明
└── tauri-storage-architecture-v2.md # 图片存储 V2 当前实现与后续路线
```

桌面专属功能只有在确定进入后续阶段时，才增加对应产品和架构文档。

## 9. 下一步

图片 Native Store、元数据分页、按需图片读取、LRU/恢复以及 Web/Tauri Repository 分离
已经接入。当前开发阶段不迁移旧图片缓存；后续重点是 scoped asset URL、压力测试和
Windows/Linux 实机验证。
