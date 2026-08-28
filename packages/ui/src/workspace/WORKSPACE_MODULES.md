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
- `use-workspace-collaboration-preview.ts`：维护 A（不可变源 Blob）、B（正式协作 Blob）和每图独立的 C（Commit 预览文件 LRU）；使用 A 和 JSON 参数文档渲染 B/历史 C，当前 Commit 的 C 直接从 B 生成。
- `use-workspace-editor-state.tsx`：编辑器初始参数和加载状态。
- `use-workspace-rollback-commands.ts`：Owner 回退 Commit/Activity 栈，并同步 `historyRolledBack`。

### 实时和协作控制

- `use-workspace-collaboration-commands.ts`：加入/离开协作、协作者移除等命令。
- `use-workspace-source-transfer.ts`：原图请求、分片接收、校验和缓存。
- `use-workspace-publishing.ts`：发布占位图、缩略图和协作图片元数据。
- `use-workspace-reactions.ts`：Reaction 和消息相关状态。
- `use-workspace-share-commands.ts`、`use-workspace-rotation.ts`：固定分享链接创建和刷新。

## 核心数据规则

### 协作图片内存

- A 在图片进入协作内存时只从 Repository 或实时源传输读取一次，之后保持不可变。图片从 Library
  进入 Working 时，从 A 生成保持宽高比、不放大、最大 `720×540`、WebP quality `0.80` 的原始
  卡片缩略图，并写入 Repository 的 thumbnail 缓存文件；协作容器不保存该缩略图 Blob。
- B 是正式协作状态，始终等于 A 应用当前最新参数后的唯一一份全尺寸 Blob；输出格式与 A 相同，
  使用最高质量档位，不经过预览降采样或预览质量压缩。只有 Commit 或正式回退更新 B，协作画布和
  最大化视图直接显示 B。
- C 是每张协作图片独立的预览文件 LRU，key 是不可变 `commitId`。生成时保持处理结果的宽高比且
  不放大，输出宽高只要求分别不超过 `720×540`，并使用 quality `0.80` 的 WebP；value 只保存
  文件地址、释放标识、实际宽高和文件字节数，不保存预览 Blob。Activity、
  Original、已提交 Proposal、
  回退确认和 Working 图片卡片复用 C；命中时移动到 MRU。当前 Commit 在 B 更新后直接以 B 为输入
  异步生成 C，历史 Commit 未命中时才从 A 和对应参数文档重放生成。
- 每图 C 同时限制为 12 条和 12 MiB，任一上限超出即淘汰最久未使用项。关闭弹窗只清活动引用，
  不删除仍在 LRU 中的文件；没有稳定 Commit ID 的 Proposal 文件关闭后立即释放。
- 本端或远端 Commit 开始生成 B 时，Working 卡片保留上一张稳定 C 并覆盖 loading；B 更新后再后台
  异步预热当前 `commitId` 的 C，文件完成后原子刷新卡片并移除 loading。预热失败不回滚 B。
- 协作期间 Owner 发给协作者的 B 预览只用于实时传输，不得覆盖 Repository 中的原始 Working
  thumbnail。Owner 直接停止协作时，必须先把参数文档和 Current 重置为初始状态，再释放 B、C
  和 Native A 缓存；普通 Working 卡片随后直接读取原始 thumbnail 缓存文件，不重新处理全尺寸 A，
  也不得因旧参数恢复 effect 重新生成 B/C。
- `Save Image` 和 `Save & Stop` 都通过按钮旁 Popover 选择覆盖或新建。覆盖会把当前 B 作为新的 A
  写入源文件缓存，清空旧参数历史，并用 B 生成的 thumbnail 缓存文件覆盖当前卡片；继续协作时从
  新 A 和空参数文档重新建立容器。新建会保留原图片及其原始 thumbnail，并在 Working 中为 B 创建
  独立图片和独立 thumbnail 缓存文件。`Save & Stop` 完成相同保存后再停止协作。
- 已有参数的图片再次进入编辑器时，B 同时作为稳定 poster 立即显示；为了替换同类型参数而从 A
  生成的一次性 editor preview 只作为编辑基线。颜色、裁剪、尺寸和 Review 组件必须等该基线完成
  解码及当前参数绘制后再原子移除 B poster，不能暴露未应用参数的中间帧，也不能因基线到达而重置
  用户已修改的控件状态。
- 裁剪弹窗必须先从参数文档得到已有的归一化裁剪框，再挂载裁剪内容和加载图片；不能先用默认裁剪框
  绘制首帧，再通过 effect 跳到已有裁剪位置。
- 编辑器为替换同类型参数生成的基线属于一次性 editor preview Blob，不进入按 Commit 缓存的 C。
- Desktop 使用 A 的 `cacheKey` 复用 Rust 的 `960×720` 有界解码预览基线；C 由 Native 直接写入
  专用缓存文件并通过只读 `picbind-preview:` 地址显示。图片删除、停止协作、源替换或离开 Workspace
  时必须释放 A 的 Native 内存和全部 C 文件。

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

- `originalBlob` 是 A。
- `workingBlob` 是 B。
- `parameterDocument` 是当前 JSON 参数。
- `previewCache` 是以 Commit ID 为键的 C 文件地址 LRU，`cardPreview` 是当前 Working 卡片稳定引用，
  `activePreview` 只是当前弹窗引用。
- `editorPreviewBlob` 是不进入 C 的一次性编辑器基线。

普通 Working thumbnail 和 C 都是缓存文件，但所有权不同：普通 thumbnail 由 Repository 按图片
记录管理，C 由协作容器按 Commit LRU 管理；两者都不能作为长期缩略图 Blob 放入 React 状态。

不要为每个 Activity 创建独立业务图片。首次历史预览使用同一个 A 重新应用目标参数并生成缓存文件，
后续直接复用 Commit 对应的 C 地址。

### UI 等待反馈

- Workspace 中任何需要等待的图片读取、参数重放、编码、缓存生成和图片解码都必须提供进行中反馈。
  任务开始后保留上一张稳定图片，在其上叠加 loading；不能清空容器、回退 A、显示未应用参数的
  中间帧，或先显示起点再闪到最终结果。
- 极短任务可以使用短暂的 loading 延迟显示阈值来避免闪烁，但处理状态必须立即建立，并阻止同一
  操作被重复提交。超过阈值后必须显示反馈。
- B 或 C 的 Blob/文件生成完成不等于 UI 更新完成。新图片必须先在隐藏或叠加层中完成解码，并由
  `load`/等价的首帧成功信号确认后，再原子切换可见内容并结束 loading。失败时保留上一张稳定图片，
  清除 loading 并显示错误反馈。
- loading 生命周期必须绑定图片 ID、Commit ID 和请求序列。旧请求的成功、失败或取消不能替换新
  结果，也不能提前关闭新请求的 loading。

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
7. 涉及耗时 UI 时，确认上一帧保留到新资源完成解码和首帧渲染，等待期间有反馈且过期结果不会
   结束当前 loading。
8. 修改完成后运行 Workspace 检查和测试，不要只依赖 TypeScript 编译。
