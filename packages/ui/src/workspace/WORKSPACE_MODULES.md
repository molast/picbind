# Workspace 模块说明

本文档用于帮助开发者和 AI 快速定位 Workspace 功能。修改 Workspace 前应先阅读本文件，并优先复用已有模块，不要在 `workspace-page.tsx` 中重新实现已有业务逻辑。

## 总体结构

```text
page/workspace-page.tsx       页面编排、实时事件入口、跨模块状态协调
page/                         页面区域和页面级状态
components/                   页面可复用组件
dialogs/                      弹窗组件
hooks/                        功能状态和业务命令
types.ts                      Workspace 领域类型
repository.ts                 IndexedDB 本地持久化
realtime.ts                   WebSocket/RTC 实时连接
realtime-protocol.ts          实时协议帧和可靠传输
source-transfer.ts            原图分片传输
image-protocol.ts             图片 JSON 参数协议
activity.ts                   协作 Activity 过滤和 Current 推导
collaboration-image-container.ts 协作图片源数据和参数渲染容器
utils/                        纯函数、显示映射和参数回放
*.test.ts                     Workspace 单元测试
```

## 页面和 UI

### `page/workspace-page.tsx`

Workspace 的页面控制器。负责加载 Workspace、本地状态组合、实时事件分发、弹窗状态传递和页面布局。

修改原则：

- 只做页面级编排和跨模块协调。
- 图片命令放到 `hooks/`，UI 放到 `components/` 或 `dialogs/`。
- 实时事件新增分支前，先确认是否应该抽到专用 Hook。
- 不要在这里重新生成 Commit、重复实现 Activity 栈逻辑或直接处理图片 Blob。

### `page/workspace-page-sections.tsx`

页面级区域组合，例如 Gallery、Sidebar、Processing 区域。这里只处理布局和区域之间的 Props。

### `components/`

页面可复用组件：

- `workspace-gallery.tsx`、`workspace-gallery-card.tsx`：Library/Working 图片列表和卡片。
- `workspace-image-sidebar.tsx`：选中图片的信息、处理操作、Activity 和历史 Commit。
- `workspace-collaboration-panel.tsx`：协作者、Proposal、Activity、消息和 Reaction。
- `workspace-activity-list.tsx`：Activity 展示、Current 高亮、Commit ID tooltip。
- `workspace-processing-canvas.tsx`：协作图片参数渲染画布。
- `workspace-editor-dialogs.tsx`：Crop、Color、Review 等图片编辑入口。
- `workspace-image-media.tsx`：图片 Blob、缓存预览和占位图显示。

组件不应直接修改 Repository 或发送实时事件，应通过 Props 调用页面 Hook 暴露的命令。

### `dialogs/`

单一职责弹窗：Activity 预览/回退、Proposal 审批、删除、保存、设置、原图请求和处理结果确认。弹窗只负责展示和触发回调，业务状态由页面或 Hook 管理。

## Hooks 和业务命令

### 图片和文件

- `use-workspace-file-commands.ts`：导入图片、创建初始图片和初始 Commit。
- `use-workspace-image-commands.ts`：Library/Working 移动、删除、开始/取消协作。
- `use-workspace-processed-results.ts`：处理结果保存前的确认和目标选择。
- `use-workspace-processed-result-command.ts`：将处理结果转换为操作或新图片。

### 协作图片和参数

- `use-workspace-operation-commands.ts`：创建图片操作。协作者必须先创建并保存本地 Commit，再创建 Proposal 并发送给 Owner；Owner 操作直接创建 Commit。
- `use-workspace-operation-editor.ts`：读取已有参数，初始化编辑器。
- `use-workspace-collaboration-preview.ts`：使用单一源数据和 JSON 参数文档渲染协作预览。
- `use-workspace-editor-state.tsx`：编辑器初始参数和加载状态。
- `use-workspace-rollback-commands.ts`：Owner 回退 Commit/Activity 栈，并同步 `historyRolledBack`。

### 实时和协作控制

- `use-workspace-collaboration-commands.ts`：加入/离开协作、协作者移除等命令。
- `use-workspace-source-transfer.ts`：原图请求、分片接收、校验和缓存。
- `use-workspace-publishing.ts`：发布占位图、缩略图和协作图片元数据。
- `use-workspace-reactions.ts`：Reaction 和消息相关状态。
- `use-workspace-share-commands.ts`、`use-workspace-rotation.ts`：固定分享链接创建和刷新。

## 核心数据规则

### Commit

Commit 是图片操作历史的唯一版本标识，图片处理只保存 JSON 参数，不把处理后的 Blob 作为业务源数据。

协作者提交的固定流程：

```text
生成 localCommit
  -> 保存到协作者本地 Repository
  -> Proposal.commit 携带完整 Commit
  -> Owner 原样保存该 Commit
  -> Owner 审批后原样广播 commitCreated
  -> 其他协作者保存同一个 commitId
```

Owner 不得因为 Proposal 缺少 Commit 而重新生成新的 Commit ID。旧数据或非法 Proposal 应被拒绝并提示原因。

### Parameter Document

参数文档是当前图片的 JSON 状态，每种操作类型只保留最新配置，例如 Crop、Brightness、Doodle。历史 Commit 保存该操作发生时的参数队列，用于预览和回退。

### Activity

Activity 是按时间顺序排列的协作操作栈：

- Current 由图片的 `currentCommitId` 推导。
- 同一 Commit 可能有 `proposalSubmitted` 和 `proposalApproved`，展示和回退时应使用该 Commit 的最后一条有效 Activity。
- 回退到目标 Activity 时，目标之后的 Activity 和 Commit 全部移除。
- Owner 可以审批、拒绝和回退；协作者只能预览，不能回退。

### Collaboration Image Container

每张协作图片只有一个独立容器：

- `source` 是原始图片源数据。
- `parameterDocument` 是当前 JSON 参数。
- `preview` 是根据源数据和参数渲染出的临时预览。

不要为每个 Activity 创建独立业务图片。历史预览应使用同一个源数据重新应用目标参数。

## 实时通信

### `realtime.ts`

管理 WebSocket 信令连接、RTC PeerConnection、事件路由和可靠传输。Owner 与每个协作者之间使用独立 RTC 连接，协作者之间不直接通信。

### `realtime-protocol.ts`

处理协议帧、序列号、可靠事件、重复事件和二进制元数据。新增事件类型时，同时更新策略校验和测试。

### 事件处理注意事项

- Worker 只负责中转，不应加入图片业务逻辑。
- `commitCreated`、`proposalDecision`、`historyRolledBack` 必须包含足够的 Commit/参数信息，让接收方可以本地恢复。
- 事件处理应保证幂等，重复收到同一个 Commit ID 不得产生重复历史记录。
- React 状态更新不能通过不稳定的实时回调依赖触发订阅重建。

## 持久化和协议

- `repository.ts`：IndexedDB 的 Workspace、Image、Proposal、Commit、Activity 和缓存读写。图片源数据和缩略图使用缓存表，不放进 React 状态长期持有。
- `image-protocol.ts`：图片参数文档校验、合并、操作队列和大小限制。
- `source-transfer.ts`：原图分片组装、Manifest 校验、重复块处理和错误清理。
- `policy.ts`：事件来源、Proposal、Operation 的权限和结构校验。
- `state-machine.ts`：Workspace、Image、Proposal、Commit 状态转换规则。

## 测试入口

修改 Workspace 后至少运行：

```bash
pnpm --dir packages/ui check
pnpm --dir packages/ui test:workspace
git diff --check
```

重点测试文件：

- `repository.test.ts`：本地数据、Commit 历史和缓存生命周期。
- `activity.test.ts`：Current 推导和 Activity 过滤。
- `image-protocol.test.ts`：参数文档和操作队列。
- `policy.test.ts`：Proposal 和事件校验。
- `realtime-client.test.ts`、`realtime-protocol.test.ts`：WebSocket/RTC 和可靠事件。
- `source-transfer.test.ts`：原图分片传输。
- `state-machine.test.ts`：状态转换。

## AI 修改检查清单

1. 先确认这是 UI、命令、协议、持久化还是实时事件问题。
2. 找到对应模块后，复用已有 Hook、纯函数和类型。
3. 涉及 Commit 时，同时检查 Owner、协作者、本地保存和广播路径。
4. 涉及 Activity 时，同时检查 Current 推导、回退截断和持久化删除。
5. 涉及图片时，确认没有把处理后的 Blob 替换成业务源数据。
6. 涉及实时事件时，确认重复事件幂等，并检查 WebSocket 和 RTC 两条路径。
7. 修改完成后运行 Workspace 检查和测试，不要只依赖 TypeScript 编译。
