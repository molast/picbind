# PicBind Workspace 页面拆分计划

## 1. 目标

将 `packages/ui/src/workspace/workspace-page.tsx` 收敛为 Workspace 页面主结构和区域编排文件。页面文件只负责：

- 读取 Workspace 页面级状态和路由参数；
- 组织页面布局、区域顺序和响应式结构；
- 将状态与事件回调传给子组件；
- 控制页面级弹窗的显示顺序和层级。

图片卡片、协作面板、Activity、图片处理画布、媒体渲染、操作菜单、弹窗和纯业务转换逻辑都必须放到对应模块中。禁止把现有大文件整体改名为 `WorkspacePageController` 或其他单一大文件。

## 2. 当前范围盘点

当前文件约 2000 行，职责混合在同一个文件中：

### 页面级职责

- Workspace 加载、恢复、本地缓存和运行状态；
- Workspace realtime 生命周期；
- Gallery、Working、右侧面板的布局；
- 页面级选择状态、通知状态和弹窗状态。

### 可拆分的 React 组件

- `WorkspaceGalleryCard`
- `WorkspaceImageActionMenu`
- `WorkspaceLibraryItem`
- `WorkspaceActivityList`
- `ProposalStatusIcon`
- `WorkspaceAction`
- `ColorControl`
- `WorkspaceProcessingCanvas`
- `WorkspaceImageMedia`
- `BlobImageMedia`

### 可拆分的纯逻辑

- 图片操作类型和协议参数转换；
- Activity 名称、Proposal 映射和状态展示；
- Blob/placeholder/图片尺寸处理；
- Workspace header 样式转换；
- 页面级状态到 Gallery、协作面板和弹窗 props 的组装。

## 3. 目标目录

```text
packages/ui/src/workspace/
├── page/
│   ├── workspace-page.tsx          # 页面主结构，目标小于 500 行
│   ├── workspace-page-state.ts     # 页面状态类型和区域 props 类型
│   └── workspace-page-sections.tsx # 页面区域编排，可选，仅放结构
├── components/
│   ├── workspace-gallery.tsx       # Gallery / Working 区域
│   ├── workspace-gallery-card.tsx  # 单张 Working 图片卡片
│   ├── workspace-library.tsx       # Origin Library 与 Library item
│   ├── workspace-sidebar.tsx       # 图片信息、概览、分享区域
│   ├── workspace-collaboration-panel.tsx
│   ├── workspace-activity-list.tsx
│   ├── workspace-image-action-menu.tsx
│   ├── workspace-processing-canvas.tsx
│   ├── workspace-image-media.tsx
│   └── workspace-action.tsx
├── dialogs/
│   ├── workspace-dialogs.tsx       # 页面级 dialog 组合器，禁止放业务逻辑
│   ├── workspace-delete-dialog.tsx
│   ├── workspace-leave-dialog.tsx
│   ├── workspace-source-request-dialog.tsx
│   ├── workspace-proposal-dialog.tsx
│   ├── workspace-activity-preview-dialog.tsx
│   ├── workspace-save-dialog.tsx
│   └── workspace-settings-dialog.tsx
├── hooks/
│   ├── use-workspace-page-state.ts
│   ├── use-workspace-dialogs.ts
│   ├── use-workspace-selection.ts
│   └── use-workspace-preview.ts
└── utils/
    ├── workspace-image-display.ts
    ├── workspace-activity-display.ts
    └── workspace-operation-mapping.ts
```

已有的 `repository.ts`、`realtime.ts`、`image-protocol.ts`、`image-flow.ts` 和 `collaboration-image-container.ts` 继续作为底层模块使用，不在本次任务中重复搬迁或重命名。

## 4. 分阶段实施

### 阶段 0：建立基线

1. 保留当前工作区已有改动，不做行为重构。
2. 执行 `pnpm --dir packages/ui check`。
3. 执行 `pnpm --dir packages/ui test:workspace`。
4. 记录当前 Workspace 页面手工验收点：
   - 首页进入自己的 Workspace；
   - 分享链接进入协作者 Workspace；
   - WebSocket/RTC 连接与协作者数量；
   - Gallery、Working、图片选择和图片操作；
   - 原图请求、Proposal、Activity、回退；
   - 删除/移回 Library、分享链接和设置弹窗。

每一阶段都必须先通过自动检查，再进行下一阶段。阶段失败时只回退该阶段新增文件和导入，不回退用户已有业务修复。

### 阶段 1：迁移无状态展示组件

迁移顺序：

1. `BlobImageMedia`、`useBlobUrl`、`WorkspaceImageMedia`；
2. `WorkspaceAction`、`ColorControl`；
3. `WorkspaceImageActionMenu`；
4. `WorkspaceGalleryCard`；
5. `WorkspaceLibraryItem`。

要求：

- 组件只接收 props，不读取页面状态、不调用 repository/realtime；
- 图片操作通过回调向上通知；
- `WorkspaceCardOperation` 和公开 props 类型放在组件文件或 `page/workspace-page-state.ts`；
- locale 文案由父层传入，组件内部不得新增硬编码中英文。

验证：TypeScript 检查、Workspace 测试、图片卡片和图片媒体的手工检查。

### 阶段 2：迁移 Gallery 与 Origin Library 区域

新增 `workspace-gallery.tsx` 和 `workspace-library.tsx`，把 Gallery/Working 的网格、拖拽区域、空状态、折叠状态和卡片列表移出页面文件。

组件只接收：

- 图片列表和当前选中 ID；
- Owner/Collaborator 角色；
- loading、dragging、source 请求状态；
- 选择、上传、移动、删除、下载、最大化和图片操作回调。

页面文件保留事件实现，不在区域组件内直接修改页面状态。

验证重点：Origin 到 Working、Working 到 Library、协作图片不能删除、缩略图/placeholder 展示、拖拽上传。

### 阶段 3：迁移右侧面板

新增 `workspace-sidebar.tsx` 和 `workspace-collaboration-panel.tsx`：

- 图片信息、Workspace overview、分享链接和图片处理操作；
- 在线协作者、Proposal、Reaction、Activity 和 Messages。

`workspace-activity-list.tsx` 负责 Activity 的显示、当前步骤高亮、Proposal 状态标记和 Owner 回退入口；回退、预览和 Proposal 决策仍由页面 hook/业务逻辑提供。

验证重点：Owner/Collaborator 权限差异、无协作者时按钮禁用、Owner current 高亮、协作者只能预览不能回退、Reaction 数量和消息状态。

### 阶段 4：迁移图片处理画布和媒体资源

迁移 `WorkspaceProcessingCanvas`、图片缩放/拖动逻辑和 Blob URL 生命周期到 `workspace-processing-canvas.tsx` 与 `workspace-image-media.tsx`。

要求：

- 组件只消费源数据和参数文档生成的 `renderedBlob`；
- 不在组件内重新请求 Worker、Source 或数据库；
- Blob URL 必须在替换和卸载时释放；
- 画布缩放不能触发页面缩放；
- 预览加载期间显示稳定 loading，不能先闪原图。

验证重点：最大化处理画布、缩放、回退预览、协作者源数据到达后的渲染切换。

### 阶段 5：迁移弹窗

每个弹窗拆为独立文件，弹窗只负责展示和表单输入：

- 删除/移回 Library；
- 离开 Workspace；
- Source 请求接受/拒绝；
- Proposal 预览、拒绝和决策；
- Activity 预览与回退确认；
- 协作图片保存；
- Workspace 设置。

弹窗的保存、回退、发送 realtime、写入 repository 等动作通过 props 回调传入。`workspace-dialogs.tsx` 只做条件渲染和层级组合，不成为新的业务控制器。

验证重点：取消/确认、点击遮罩、键盘操作、Owner/Collaborator 文案和禁用状态。

### 阶段 6：迁移纯逻辑和页面 hook

将以下逻辑移出页面文件：

- `protocolOperationType`、`parameterDocumentOperations`、`numberParameter` 到 `utils/workspace-operation-mapping.ts`；
- `placeholderFrom`、Blob 转换、媒体显示判断到 `utils/workspace-image-display.ts`；
- Activity 名称、Proposal 映射和当前步骤判断到 `utils/workspace-activity-display.ts`；
- 页面状态、弹窗状态、选中图片和预览状态分别迁移到 hooks。

Hook 按职责拆分，禁止创建一个包含所有原页面状态的巨型 hook。realtime 和 repository 调用保持在现有业务边界内，必要时通过小型 command hook 暴露单一操作。

### 阶段 7：收敛主页面

完成所有迁移后，`workspace-page.tsx` 只保留：

- 页面初始化和页面级 hook 组合；
- header、notice、主网格和右侧栏的结构；
- `WorkspaceDialogs`；
- 子组件所需 props 的组装。

目标：

- `workspace-page.tsx` 小于 500 行；
- 不出现 `function Workspace...` 子组件定义；
- 不包含图片媒体、画布、Activity 列表和弹窗 JSX；
- 不包含 repository/realtime 细节之外的纯展示逻辑；
- 不新增 `WorkspacePageController` 这类替代性大文件。

## 5. 每阶段验收清单

- `pnpm --dir packages/ui check` 通过；
- `pnpm --dir packages/ui test:workspace` 通过；
- `git diff --check` 通过；
- 无新的界面硬编码中英文，文案继续从 `locales` 获取；
- Workspace 页面不启动本地 Worker；
- WebSocket/RTC、Source、placeholder、thumbnail 和参数 JSON 协议行为不变；
- 不把图片 Blob、预览数据或协作状态写入 Worker/D1；
- 桌面端和 Web 端共享的 UI 类型导入无循环依赖。

## 6. 风险与控制

| 风险 | 控制措施 |
| --- | --- |
| 拆分时改变协作时序 | 先迁移展示组件，再迁移 hook；每阶段运行 realtime 测试 |
| 状态被复制到多个组件 | 状态只由页面 hook 持有，组件通过 props 通信 |
| 新文件变成新的巨型 Controller | 每个 hook/组件限制单一职责，并在 review 中检查行数和依赖 |
| locale 文案丢失 | 所有可见文案通过 props 或 `getWorkspaceLabels` 传入 |
| Blob URL 泄漏 | 保留并测试 `useBlobUrl` 的清理逻辑 |
| 回退或 Proposal 行为回归 | 保留现有 Workspace 测试，并补充组件 props 和 Activity 高亮测试 |

## 7. 完成标准

只有满足以下条件才算拆分完成：

1. `workspace-page.tsx` 仅包含页面主结构；
2. 所有内部 React 组件和弹窗均位于对应目录；
3. 图片、Activity、Proposal、realtime、Source 和参数队列行为与拆分前一致；
4. 自动测试全部通过，且完成阶段性手工验收；
5. 代码 review 能从文件名和目录直接判断每个功能的归属。
