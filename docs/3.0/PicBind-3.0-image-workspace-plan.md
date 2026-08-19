# PicBind 3.0 Image Workspace 改版实施方案

文件名：`PicBind-3.0-image-workspace-plan.md`

## 1. 项目目标

PicBind 3.0 将 `Image Workspace` 从辅助功能升级为产品核心。

核心定位：

> Image Workspace 是一个围绕图片素材进行处理、审阅、协作和版本提交的工作空间。

3.0 的核心原则：

1. Workspace 是素材空间，不是协作空间。
2. 图片加入 Workspace 后默认不进行协作数据传输。
3. 协作以“图片”为最小单位，而不是整个 Workspace。
4. Preview、Source Data、Operation、Commit 分层传输。
5. Workspace Owner 是最新数据的 Source of Truth。
6. 协作者不能直接修改 Owner 的最终状态，只能提交 Proposal/Operation。
7. Owner 通过 Apply / Reject / Defer 管理协作修改。
8. 每次 Owner 接受修改后形成新的 Commit。
9. Workspace 外观通过 Style JSON 管理。
10. Room 不再作为用户侧一级产品概念，退化为协作连接/会话层。

### 1.1 Workspace 入口与路由

- 主导航中的 Image Workspace 直接进入 `/workspace`。
- 进入 Workspace 不创建 Room，也不要求先建立协作会话。
- Workspace 页面必须在没有 Room 的情况下独立完成图片添加、处理、审阅和下载。
- 主 Workspace 页面不展示 Room ID、创建 Room、复制 Room 链接、最小化 Room 或离开 Room 等入口。
- `/share?roomId=...` 仅作为旧分享链接的兼容入口，不属于 3.0 主产品流程。

---

## 2. 3.0 总体产品结构

```text
PicBind
│
└── Image Workspace
    │
    ├── Images
    │   ├── Private
    │   └── Shared
    │
    ├── Context Panel
    │   ├── Selected Image Context
    │   ├── Quick Actions
    │   └── Share Workspace
    │
    ├── Collaboration Panel
    │   ├── Collaborators
    │   ├── Activity
    │   ├── Quick Reactions
    │   └── Messages
    │
    ├── Collaboration
    │   ├── Image Share
    │   ├── Preview Sync
    │   ├── Source Request
    │   ├── Proposal
    │   └── Commit
    │
    └── Workspace Style
        └── Style JSON
```

## 3. 第一阶段：Workspace 基础模型

### 3.1 Workspace 生命周期

实现以下生命周期：

```text
未登录用户
    ↓
临时 Workspace
    ↓
登录
    ↓
绑定 Workspace
    ↓
固定 Workspace
```

#### 临时 Workspace

- 可以正常使用图片功能。
- 可以添加、处理图片。
- 数据以本地 Workspace 为主。
- 没有固定的公开分享身份。
- 点击 Share Workspace 时提示登录。
- 不要求为了创建 Workspace 而强制登录。

#### 固定 Workspace

登录后：

```text
User
 └── Workspace
      ├── workspace_id
      ├── owner_id
      ├── images
      ├── collaborators
      ├── commits
      └── style
```

Workspace ID 作为固定分享地址的一部分。

例如：

`/workspace/{workspace_id}`

### 3.2 任务

- [x] 定义 Workspace 数据模型。
- [x] 定义临时 Workspace 状态。
- [x] 定义固定 Workspace 状态。
- [x] 定义登录后 Workspace 绑定流程。
- [x] 定义 Workspace ID。
- [x] 定义 Workspace Owner。
- [x] 定义 Workspace 本地缓存模型。
- [x] 定义 Workspace 创建/恢复流程。
- [x] 定义 Workspace 分享链接模型。

当前实现已包含 Workspace 身份、Owner、生命周期、本地元数据缓存、不依赖 Room 的 `/workspace` 页面入口，以及按 Workspace 隔离的本地图片列表与原始图片数据持久化。Preview 已支持所有者本地缓存和在线实时同步；Source Data 已支持请求审批、实时分块传输和协作者本地缓存；Proposal Review、Commit 广播、New Version 提示及 Owner 会话内版本历史也已实现。

## 4. 第二阶段：Workspace 页面结构

当前进度：

- [x] 新增 `/workspace` 直接入口。
- [x] 进入页面时不创建或加入 Room。
- [x] 显示 Workspace 名称与临时状态。
- [x] 支持本地图片添加、处理、审阅和下载。
- [x] 显示 Workspace 概览、图片统计和本地存储说明。
- [x] 实现图片选中上下文与 Quick Actions。
- [x] 实现临时 Workspace 登录提示与固定 Workspace 链接。
- [x] 增加 Workspace Settings 入口。
- [x] 持久化 Workspace 图片列表与图片数据。
- [x] 实现图片选择上下文、Workspace Share 与 Settings。

Workspace 页面采用：

```text
┌──────────────────────────────────────────────────────┐
│ Workspace Header                                     │
│ Name / Members / Share / Settings                   │
├───────────────────────────────┬──────────────────────┤
│                               │ Context Panel        │
│                               │                      │
│                               │ Selected Image       │
│       Image Workspace         │ Quick Actions        │
│                               │ Workspace Share      │
│       Image List              │                      │
│                               │                      │
└───────────────────────────────┴──────────────────────┘
```

### 4.1 Workspace Header

包含：

- Workspace 名称。
- 当前协作者数量。
- Collaboration Panel 入口。
- Workspace Share。
- Workspace Style/Settings。

### 4.2 Context Panel

固定分成三部分：

#### A. Selected Image Context

展示：

- 图片名称。
- 尺寸。
- 格式。
- 文件大小。
- 当前状态。
- 当前 Commit。
- 是否正在协作。
- 当前协作者。

#### B. Quick Actions

根据当前图片动态提供：

- Crop。
- Compare。
- Compress。
- Resize。
- Adjust。
- Annotate。
- 其他 Workspace 工具。

#### C. Workspace Share

未登录：

This is a temporary workspace.
Sign in to create a permanent share link.

已登录：

Copy Workspace Link

### 4.3 任务

- [x] 完成 Workspace 主布局。
- [x] 完成 Header。
- [x] 完成 Context Panel。
- [x] 完成图片选中状态。
- [x] 完成 Quick Actions。
- [x] 完成临时 Workspace 分享提示。
- [x] 完成固定 Workspace 分享链接。
- [x] 完成 Workspace Settings 入口。

## 5. 第三阶段：图片模型与图片状态

Workspace 中的图片必须区分：

- Private
- Shared
- Working
- Reviewing

推荐状态：

```text
Private
  ↓
Shared
  ↓
Working
  ↓
Reviewing
  ↓
Committed
```

### 5.1 Private

图片只属于 Owner：

- 协作者可以知道 Workspace 中存在图片，但不接收 Preview。
- 不进入协作同步。

### 5.2 Shared

Owner 主动点击：

Share for Collaboration

之后：

- 向协作者发送 Preview。
- 图片进入 Collaboration Image List。
- 协作者可以请求 Source Data。

### 5.3 Working

表示当前有人正在处理。

例如：

Alice is working on this image

### 5.4 Reviewing

表示存在等待 Owner 处理的 Proposal。

### 5.5 任务

- [x] 定义 Image 数据模型。
- [x] 增加 image collaboration state。
- [x] 增加 image current_commit。
- [x] 增加 image shared 状态。
- [x] 实现 Share Image。
- [x] 实现 Unshare Image。
- [x] 实现 Working 状态。
- [x] 实现 Reviewing 状态。
- [x] 实现图片状态 UI。

当前实现会将图片协作状态和 `current_commit` 与本地图片记录一起按 Workspace 隔离持久化。Share Image / Unshare Image 负责切换图片是否进入协作；第五阶段已经接入 Preview 生成、本地缓存和 Workspace 实时连接，Preview 只从所有者本地发送给当前在线协作者。

## 6. 第四阶段：协作者系统

Collaboration Panel：

```text
Collaboration Panel
│
├── Collaborators
├── Activity
├── Quick Reactions
└── Messages
```

### 6.1 Collaborators

显示：

- 用户头像。
- 用户名称。
- Online / Offline。
- 当前操作。
- 当前处理图片。

例如：

Alice
● Online
Editing IMG_002

### 6.2 Activity

记录协作动态：

Alice shared IMG_002
Bob requested source data
Alice proposed a crop
Owner approved Proposal #12
Owner rejected Proposal #13

Activity 是结构化事件，不应该依赖聊天消息。

### 6.3 Quick Reactions

提供低成本反馈：

👍
❤️
👀
✅
❗

用于快速表达意见，不参与图片状态计算。

### 6.4 Messages

底部提供普通消息发送。

消息用于：

- 沟通。
- 解释原因。
- 补充说明。

不要让 Message 承担 Proposal/Commit 的业务逻辑。

### 6.5 任务

- [x] 实现 Collaborator 数据模型。
- [x] 实现 Online/Offline。
- [x] 实现当前操作状态。
- [x] 实现 Activity。
- [x] 实现 Quick Reactions。
- [x] 实现消息模块。
- [x] 建立 Activity 与 Collaboration Event 的关系。

当前实现已提供 Collaboration Panel、本机协作者在线状态与当前操作、结构化 Activity、快捷反应和消息界面。图片 Share/Unshare 会生成 Collaboration Event，Activity 从事件派生；Reaction 和 Message 不参与图片状态计算。跨设备 Presence、Event、Reaction 和 Message 传输仍由第十三阶段的数据同步层实现。

## 7. 第五阶段：图片 Preview 协作同步

这是 3.0 最重要的数据传输优化之一。

旧模型：

```text
Add Image
    ↓
立即发送 Preview
```

新模型：

```text
Add Image
    ↓
Private
    ↓
Owner 点击 Share
    ↓
Shared
    ↓
发送 Preview
```

### 7.1 Preview

Preview 用于：

- 协作者识别图片。
- 协作者浏览待处理素材。
- 判断是否需要请求 Source Data。

Preview 不用于：

- 原图处理。
- 最终编辑。
- 最终导出。

### 7.2 协作者进入 Workspace

协作者看到：

```text
All Workspace Images
│
├── Private
│   └── 不接收 Preview
│
└── Shared
    └── 接收 Preview
```

Shared 图片标记：

👥 Shared
✏️ Working

### 7.3 任务

- [x] 设计 Preview 数据结构。
- [x] 实现 Share Image 后 Preview 发送。
- [x] 实现协作者 Preview 接收。
- [x] 实现 Preview 本地缓存。
- [x] 实现 Workspace 重新进入后的 Preview 恢复。
- [x] 禁止 Private 图片自动发送 Preview。
- [x] 实现 Preview 更新机制。

当前实现会在图片进入 Shared 状态后生成受限 WebP Preview，并将 Preview、占位信息和更新时间随 Workspace 图片记录缓存；重新进入 Workspace 时直接恢复。所有者和协作者通过独立的 Workspace WebSocket 建立实时连接，协作者上线时所有者从本地发送当前 Shared Preview，后续 Share、更新和 Unshare 继续实时同步。协作者收到但尚未请求 Source Data 的 Preview 也会独立缓存，并受第十二阶段的失效策略管理。

Worker 只使用 D1 校验用户、Workspace 和成员关系，并使用 Workspace Durable Object 转发当前连接中的消息。Preview 和 Source Data 不写入 D1、R2 或 Durable Object Storage；所有者离线时，Worker 不提供历史图片数据。Private 图片不会生成、发送或持久化协作 Preview。该链路不复用旧 Room 协议，第十三阶段可继续将当前 Source Data WebSocket 分块转发升级为 WebRTC 直传。

## 8. 第六阶段：Source Data 请求

协作者看到 Preview 后，如果需要真正处理：

Request Source Data

流程：

```text
Collaborator
    ↓
Request Source
    ↓
Owner 收到请求
    ↓
┌───────────────┐
│ Alice 请求    │
│ IMG_002 源数据 │
│               │
│ [同意] [拒绝] │
└───────────────┘
```

### 8.1 同意

Owner：

Accept

然后发送：

- Source Data。
- 必要的图片元信息。
- 当前 Commit。
- 当前操作状态。

协作者收到后：

```text
Source Data
    ↓
Local Cache
```

### 8.2 拒绝

Owner：

Reject

可以附加原因。

例如：

暂时不希望修改原始素材。

### 8.3 Owner Offline

如果 Owner 不在线：

```text
Workspace
    ↓
Unavailable
```

协作者可以：

- 查看本地缓存。
- 查看之前同步的数据。
- 查看历史 Activity。
- 不能提交需要 Owner 确认的最新修改。

UI 必须明确：

Owner is offline.
Latest workspace data is currently unavailable.

### 8.4 任务

- [x] 定义 Source Request。
- [x] 实现请求发送。
- [x] 实现 Owner Request Dialog。
- [x] 实现 Accept。
- [x] 实现 Reject。
- [x] 实现 Reject Reason。
- [x] 实现 Source Data 传输。
- [x] 实现 Source Data 本地缓存。
- [x] 实现 Owner Offline。
- [x] 实现 Workspace Available/Unavailable 状态。

当前实现中，协作者只能针对仍处于 Shared 状态且本地尚无原图的 Preview 发起 Source Request。Worker 根据已认证的 Workspace 身份将请求定向发送给所有者；所有者可以接受，或填写可选原因后拒绝。接受后，所有者从本地读取原图，以 16 KiB 分块通过 Workspace WebSocket 仅发送给请求者，同时携带图片元信息、当前 Commit 和协作状态。Worker 仅实时转发分块，不保存图片数据。

协作者会校验请求 ID、分块序号、总分块数和总字节数，只有完整传输成功后才组装 Source Data 并写入对应 Workspace 的本地缓存。缓存记录保留 `Received` 方向，重新进入 Workspace 不会误识别为所有者图片。所有者离线或实时连接中断时，界面显示 Workspace Unavailable 状态并禁止新请求；已经授权并缓存到协作者设备的 Source Data 仍可本地查看。

## 9. 第七阶段：Operation / Proposal 模型

协作者拿到 Source Data 后，不直接上传修改后的最终图片。

所有修改转换为 Operation。

例如 Crop：

```json
{
  "type": "crop",
  "x": 120,
  "y": 80,
  "width": 1200,
  "height": 800
}
```

调整参数：

```json
{
  "type": "adjust",
  "brightness": 10,
  "contrast": -5,
  "saturation": 12
}
```

### 9.1 Operation 类型

第一阶段实现：

- Crop。
- Resize。
- Rotate。
- Brightness。
- Contrast。
- Saturation。
- Compression。
- Other Tool Operations。

### 9.2 Operation 属性

每个 Operation 至少包含：

- `operation_id`
- `image_id`
- `author_id`
- `base_commit_id`
- `type`
- `parameters`
- `created_at`

### 9.3 Proposal

多个 Operation 可以组成一个 Proposal：

```text
Proposal #12
│
├── Crop
├── Brightness +10
└── Saturation +5
```

Proposal 是协作者提交给 Owner 的完整修改请求。

### 9.4 任务

- [x] 定义 Operation 模型。
- [x] 定义参数格式。
- [x] 定义 Proposal 模型。
- [x] 定义 base_commit_id。
- [x] 实现 Operation 本地生成。
- [x] 实现 Proposal Preview。
- [x] 实现 Proposal Submit。

当前实现会在协作者处理已经获得 Source Data 的 `Received` 图片时生成本地 Proposal。Convert、Compression、Crop、Resize 和 Adjust 会转换为带有 `operation_id`、`image_id`、`author_id`、`base_commit_id`、`type`、`parameters` 和 `created_at` 的结构化 Operation；模型同时预留 Rotate 与 Other 类型。图片尚未产生正式 Commit 时，双方使用基于图片 ID 的稳定 Initial Commit 作为 `base_commit_id`。

处理结果只用于协作者本地 Proposal Preview。提交时客户端仅通过 Workspace WebSocket 发送 Proposal 和 Operation 参数，不上传处理后的图片。Worker 将 Proposal 定向转发给当前在线 Owner，并向提交者返回确认或失败状态；Proposal、预览和处理结果均不写入 D1、R2 或 Durable Object Storage。Owner 端会校验 Workspace、提交者、图片、Commit 和 Operation 归属并按 `proposal_id` 去重，完整的 Apply、Reject 和 Defer 界面在第八阶段实现。

## 10. 第八阶段：Owner Review

Owner 收到 Proposal：

```text
Collaborator
    ↓
Proposal
    ↓
Owner Review
```

Owner 可以：

- Apply
- Reject
- Defer

### 10.1 Apply

```text
Proposal
    ↓
Apply
    ↓
更新图片状态
    ↓
生成 Commit
```

### 10.2 Reject

```text
Proposal
    ↓
Reject
    ↓
Reject Reason
    ↓
Collaborator
```

协作者可以：

- Modify。
- Retry。
- Rollback。
- 再次 Submit。

### 10.3 Defer

Owner 当前正在编辑：

Owner is working...

Proposal 暂时进入：

Pending Review

Owner 完成自己的操作后再处理。

### 10.4 任务

- [x] 实现 Proposal Review UI。
- [x] 实现 Apply。
- [x] 实现 Reject。
- [x] 实现 Reject Reason。
- [x] 实现 Defer。
- [x] 实现 Pending Review。
- [x] 实现 Proposal Preview。
- [x] 实现协作者端反馈。

Owner 收到 Proposal 后会自动打开 Review UI，也可以从 Collaboration Panel 的 Pending Review 列表重新进入。Preview 由 Owner 使用本地 Source Data 和 Proposal 中的结构化 Operation 顺序生成；临时中间结果只保存在内存中并及时释放。Proposal 的 `base_commit_id` 与 Owner 当前版本不一致、参数非法或包含尚未支持的操作时，Apply 会被禁止并显示明确错误。

Apply 会再次校验基础版本，随后使用最终 Proposal Preview 替换 Owner 本地图片、更新图片状态和当前版本标识，并重新生成实时共享 Preview。Reject 会移除 Proposal，可附加拒绝原因；Defer 不修改图片，也不删除 Proposal，而是保留在 Pending Review。三种决策都通过 Workspace WebSocket 定向反馈给提交者，不写入 D1、R2 或 Durable Object Storage。Apply 产生的正式 Commit、父子关系、广播与会话内历史记录由第九阶段能力承接。

## 11. 第九阶段：Commit / 图片版本系统

每次 Owner 接受修改都创建 Commit。

```text
Image
│
├── Commit #1
├── Commit #2
├── Commit #3
└── Commit #4
```

Commit 至少包含：

- `commit_id`
- `image_id`
- `author_id`
- `parent_commit_id`
- `operations`
- `created_at`

### 11.1 Commit 原则

只有 Owner Apply Proposal 后：

```text
Proposal
    ↓
Commit
```

才改变 Workspace 的最新状态。

### 11.2 Commit 广播

Owner 创建新的 Commit：

```text
New Commit
    ↓
Collaborators
```

协作者收到：

A new version of IMG_002 is available.

提供：

[Review] [Update]

而不是自动覆盖协作者当前状态。

### 11.3 任务

- [x] 定义 Commit。
- [x] 实现 parent_commit_id。
- [x] 实现 Current Commit。
- [x] 实现 Commit 创建。
- [x] 实现 Commit 广播。
- [x] 实现协作者 New Version 提示。
- [x] 实现 Review。
- [x] 实现 Update。
- [x] 实现历史版本查看。
- [x] 实现 Rollback 基础能力。

Owner Apply Proposal 时会创建正式 Commit，记录 `commit_id`、`image_id`、作者、`parent_commit_id`、Operation 和创建时间，并将图片的 Current Commit 指向新版本。首次 Apply 会在 Owner 本地版本历史中补充 Initial Version；后续 Apply 以当前 Commit 为父版本形成线性历史。每张图片最多保留最近 20 个本地版本快照，图片字节不会随 Commit 广播发送给 Worker。

Worker 只实时广播 Commit 元数据。协作者收到后显示 New Version 提示，Review 可以对比当前本地版本与最新共享 Preview；Update 不会自动覆盖，而是重新发起 Source Data 请求，只有 Owner 同意后才替换协作者本地数据并更新 Current Commit。暂不更新的版本会保留在 Collaboration Panel 中。

Owner 可以从图片上下文打开 Version History、查看历史预览并执行基础 Rollback。Rollback 会将选中版本的本地字节恢复为当前内容，但不会删除或改写旧 Commit，而是以当前 Commit 为父版本创建新的 Rollback Commit 并继续广播。版本快照会在 Owner 本地按 Workspace 跨会话缓存，并由第十二阶段的数量与 TTL 规则清理。Commit 元数据、历史图片和 Rollback 数据均不写入 D1、R2 或 Durable Object Storage。

## 12. 第十阶段：并发修改与 Merge

这是后续必须解决的核心问题。

例如：

```text
Commit #10
   │
   ├── Owner 修改
   │
   └── Alice 修改
```

Alice 提交时：

base_commit_id = 10

但 Owner 已经产生：

Commit #11

此时 Alice 的 Proposal 基于旧版本。

系统需要检测：

Proposal.base_commit_id
        !=
Image.current_commit_id

进入：

Conflict / Merge Review

### 12.1 Owner 正在修改

如果 Owner 当前正在处理图片：

```text
Alice Proposal
      ↓
Pending
```

Owner 可以：

Review Later

完成自己的 Commit 后再 Review Alice 的 Proposal。

### 12.2 Merge Review

Owner 查看：

Current Version
        VS
Proposal Version

提供：

- Apply
- Reject
- Defer

后续可以扩展自动 Merge。

### 12.3 第一版建议

3.0 第一版不要实现复杂自动 Merge。

只需要：

- 检测版本冲突。
- 显示双方版本。
- Owner Review。
- Apply / Reject / Defer。

### 12.4 任务

- [x] 实现 base_commit_id。
- [x] 实现版本冲突检测。
- [x] 实现 Conflict 状态。
- [x] 实现 Merge Review。
- [x] 暂不实现自动 Merge。
- [x] 为后续自动 Merge 保留数据结构。

Owner 收到 Proposal 时会比较 `Proposal.base_commit_id` 与图片的 Current Commit。两者不同即进入 Conflict 状态，不再把旧版本 Proposal 当作普通错误直接阻断。若 Owner 正在处理同一图片，新 Proposal 只进入 Pending Review，不会抢占当前处理界面。

Merge Review 使用 Owner 当前图片与本地 Commit 快照中的 Proposal 基础版本生成左右对比。Owner 可以 Apply、Reject 或 Defer；基础快照已超出每图最近 20 个版本的缓存范围或已经过期时会明确提示无法生成 Proposal Version，且不会允许 Apply。第一版不执行自动 Merge。

冲突 Apply 是一次明确的人工覆盖决策：新 Commit 的 `parent_commit_id` 指向 Apply 时的 Current Commit，`merge_parent_commit_ids` 记录 Proposal 的旧基础版本，原始 Operation 仍保留其 `base_commit_id`。`WorkspaceMergeContext` 同时预留 `common_ancestor_commit_id` 与可选 `auto_merge_operations`，但当前不会生成自动合并操作。Commit 与版本图片仍不写入 D1、R2 或 Durable Object Storage。

## 13. 第十一阶段：Workspace Style

Owner 可以配置 Workspace 外观。

配置范围：

- Header。
- 背景颜色。
- 纯色。
- 渐变。
- 渐变方向。
- 文字。
- 字体。
- 字号。
- 字重。

未来可扩展：

- Workspace Logo。
- Cover。
- Brand Color。
- Panel Style。
- Style JSON。

示例：

```json
{
  "version": 1,
  "header": {
    "background": {
      "type": "gradient",
      "from": "#111111",
      "to": "#444444",
      "direction": "right"
    },
    "text": {
      "content": "My Workspace",
      "fontFamily": "Inter",
      "fontSize": 18,
      "fontWeight": 600
    }
  }
}
```

### 13.1 原则

Style JSON：

- 由 Owner 修改。
- Workspace 级别保存。
- 协作者进入 Workspace 后同步。
- 协作者本地缓存。
- 不参与图片 Commit。
- Style 更新不影响图片版本。

### 13.2 任务

- [x] 定义 Style JSON schema。
- [x] 实现 Style Editor。
- [x] 实现 Style Preview。
- [x] 实现 Header 自定义。
- [x] 实现纯色。
- [x] 实现渐变。
- [x] 实现文字样式。
- [x] 实现 Style 同步。
- [x] 实现 Style 本地缓存。
- [x] 增加 Style version。

当前 `WorkspaceStyle` 使用受限的 version 1 schema，包含 Header 背景与文字样式。背景支持纯色，以及向右、向下和右下三个方向的双色线性渐变；文字支持内容、颜色、Inter/系统/衬线/等宽字体、12-32 px 字号和 400/500/600/700 字重。颜色必须使用 `#RRGGBB`，客户端和 Worker 都会校验收到的 Style JSON，不允许注入任意 CSS。

Workspace Settings 已升级为带实时 Preview 的 Style Editor。临时 Workspace Owner 和固定 Workspace Owner 可以编辑、重置、取消或保存，协作者只能查看当前样式。保存后 Header 立即应用样式，Style `revision` 单调推进，但不会创建图片 Operation 或 Commit，也不会改变任何图片 Current Commit。

Style 保存在当前 Workspace 的本地缓存中，旧缓存没有 `style` 字段时会兼容恢复 version 1 默认值。固定 Workspace 在线协作时，Owner 通过 `styleSnapshot` 和 `styleUpdated` 实时同步完整 Style JSON；Owner 或协作者重连时由 Owner 补发 Snapshot，协作者只接受合法且 revision 更新的样式并写入自己的本地缓存。Worker 只校验和实时转发，不把 Style 写入 D1、R2 或 Durable Object Storage；跨设备服务端样式持久化不属于当前实现。

## 14. 第十二阶段：本地缓存体系

由于 Owner 是 Source of Truth，但协作者需要降低重复传输，因此必须建立本地缓存。

缓存内容：

```text
Workspace Cache
│
├── Workspace Metadata
├── Style JSON
├── Image Metadata
├── Shared Image Preview
├── Source Data
├── Current Commit
└── Activity
```

### 14.1 缓存原则

#### Preview

可以长期缓存。

#### Source Data

收到后缓存。

#### Commit

缓存当前版本和必要历史。

#### Activity

可以缓存最近一段。

### 14.2 Owner Offline

Owner Offline 时：

```text
Local Cache
    ↓
展示已有数据
```

但：

```text
需要最新 Owner 数据
    ↓
Unavailable
```

不能伪装成在线状态。

### 14.3 任务

- [x] 定义本地缓存 Schema。
- [x] 缓存 Workspace。
- [x] 缓存 Preview。
- [x] 缓存 Source Data。
- [x] 缓存 Commit。
- [x] 缓存 Activity。
- [x] 实现缓存失效策略。
- [x] 实现 Offline UI。

本地缓存 schema 已升级为 version 2，同时兼容读取 version 1。Workspace Identity、Style 和最近 Activity 保存在 Workspace 状态缓存；图片元数据、Preview、Source Data、Current Commit 以及带版本字节的 Commit Snapshot 保存在按 Workspace 隔离的图片仓库。Web 使用 IndexedDB 与本地文件缓存，Desktop 使用本地数据库与文件缓存。Preview-only 记录带有 `has_source_data = false`，恢复时不会被误认为已经获得原图。

失效规则按最后一次本地访问时间执行：协作者 Preview-only 缓存保留 30 天，已收到的协作者 Source Data 保留 90 天，Commit Snapshot 保留 30 天且每张图片最多 20 个版本，Activity 保留 30 天且最多 50 条。Owner 自己的本地源图片不应用自动 TTL。恢复时会清理缺少二进制数据、结构无效或已经过期的记录；持久化时会删除已经不属于当前 Workspace 图片/版本集合的旧记录。

Owner Offline 时，协作者继续显示仍然有效的本地缓存，并明确显示缓存图片数量；需要 Owner 最新数据的 Source Request、Proposal Update 等操作保持不可用。如果本地没有缓存，页面明确显示无缓存可用，不会把空白或旧状态伪装成在线最新结果。上述缓存始终位于用户设备，不写入 Worker、D1 或 R2。

## 15. 第十三阶段：WebRTC / 数据同步层

推荐把实时协作数据分成四个等级：

```text
Level 1
Presence
↓
Online / Offline / Current Activity
Level 2
Collaboration Event
↓
Share / Request / Proposal / Review
Level 3
Preview
↓
Shared Image Preview
Level 4
Source / Commit
↓
Source Data / Version Data
```

不要让所有数据走同一种同步方式。

### 15.1 高频实时数据

适合：

- Presence。
- Current Activity。
- Reaction。
- Typing。

### 15.2 可靠事件

适合：

- Share Image。
- Request Source。
- Proposal。
- Apply。
- Reject。
- Commit。

必须有：

- `event_id`
- `sequence`
- `timestamp`

### 15.3 大数据

适合：

- Source Data。
- Preview。
- 导出的图片。

根据实际大小选择：

- WebRTC DataChannel
- R2

### 15.4 任务

- [x] 定义 Presence。
- [x] 定义 Collaboration Event。
- [x] 定义 Event ID。
- [x] 定义 Sequence。
- [x] 定义数据可靠性等级。
- [x] 接入 WebRTC。
- [x] 实现 Preview 传输。
- [x] 实现 Source Data 传输。
- [x] 实现 Commit/Event 同步。
- [x] 实现断线重连。
- [x] 实现状态恢复。

当前实现说明：

- Workspace 同步协议统一携带 `eventId`、发送端递增 `sequence`、`timestamp`、`dataClass`、`reliability` 和 `transport`。
- Presence、Reaction 和 Typing 属于高频临时数据；Source Request、Proposal、Decision、Commit 等属于可靠事件；Preview 和 Source Data 属于大数据。
- 可靠事件保存在发送页面的内存队列中，Worker 确认实际送达后返回 `eventAck`；断线重连使用相同 Event ID 补发，接收端按 Event ID 去重。
- Sequence 出现缺口时，协作者发送 `stateRequest`；Owner 重新发送 Preview、当前 Commit 和 Workspace Style 快照。
- WebSocket 负责认证连接、Presence、可靠事件、ACK 和 WebRTC 信令。
- Preview 与 Source Data 在 WebRTC 可用时通过有序 DataChannel 直传；WebRTC 尚未连通或失败时自动回退线上 Worker WebSocket。
- Workspace 成员通过受登录态与成员权限保护的接口获取短期 Cloudflare TURN ICE 凭证；获取失败时仅回退 Cloudflare STUN。
- Commit 只同步元数据和 Operation，版本图片仍通过 Source Data 请求获取。
- 浏览器固定 1.5 秒重连；重连后恢复可靠队列，并由 Owner 主动发送当前状态快照。
- Worker 仅做临时转发和信令，不把 Preview、Source Data、Commit 图片、可靠事件队列或状态快照写入 D1、R2、KV 或 Durable Object Storage。

## 16. 第十四阶段：Workspace 状态机

需要统一定义 Workspace 状态。

```text
Local
  ↓
Connecting
  ↓
Connected
  ↓
Available
```

Owner 离线：

```text
Connected
   ↓
Owner Offline
   ↓
Unavailable
```

恢复：

```text
Owner Online
   ↓
Syncing
   ↓
Available
```

### 16.1 图片状态

```text
Private
   ↓
Shared
   ↓
Working
   ↓
Reviewing
   ↓
Committed
```

### 16.2 Proposal 状态

```text
Draft
 ↓
Submitted
 ↓
Pending
 ├── Apply
 ├── Reject
 └── Defer
```

### 16.3 任务

- [x] 定义 Workspace State Machine。
- [x] 定义 Image State Machine。
- [x] 定义 Proposal State Machine。
- [x] 定义 Commit State。
- [x] 统一前端状态管理。
- [x] 统一同步层状态。

当前实现说明：

- Workspace 运行状态统一为 `Local`、`Connecting`、`Connected`、`Syncing`、`Available`、`OwnerOffline` 和 `Unavailable`，由显式事件校验合法转换。
- 前端不再通过“实时连接”和“Owner 在线”两个独立布尔值拼装可用性；连接成功、Owner Presence、断线、Sequence Gap 和状态快照统一推进 Workspace State Machine。
- 协作者连接或重连后必须完成 Owner 状态快照同步才进入 `Available`；Owner 离线与 WebSocket 断线分别表示为 `OwnerOffline` 和 `Unavailable`。
- 图片状态统一为 `Private`、`Shared`、`Working`、`Reviewing` 和 `Committed`，分享、取消分享、开始处理、提交审阅、结束审阅、创建 Commit 和收到 Preview 均通过状态事件转换。
- 旧本地缓存和旧同步消息中的 `updated` 图片状态仍可反序列化，并迁移为 `Committed`；新数据只写出 `committed`。
- Proposal 状态统一为 `Draft`、`Submitted`、`Pending`、`Applied`、`Rejected`、`Deferred` 和 `Failed`，提交按钮和失败重试由状态机驱动。
- Commit 状态统一为 `Available`、`Applying`、`Current`、`Superseded` 和 `Failed`，新版本应用、完成与失败由状态机驱动。
- 状态机只管理前端和实时会话状态，不新增 D1、R2、KV 或 Durable Object Storage 数据；现有线上 Worker 协议结构保持不变。

## 17. 后续产品规范与测试

权限边界、MVP 范围、数据关系和完整用户工作流已迁移至：

- [`PicBind-3.0-image-workspace-product-spec.md`](./PicBind-3.0-image-workspace-product-spec.md)

主实施方案第 1-14 阶段的 Workspace 功能测试案例见：

- [`PicBind-3.0-image-workspace-plan-test-cases.md`](./PicBind-3.0-image-workspace-plan-test-cases.md)

这些内容用于约束产品范围和验收，不作为新的代码实施阶段。
