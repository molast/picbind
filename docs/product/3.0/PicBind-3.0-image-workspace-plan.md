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
10. Workspace 不再作为用户侧一级产品概念，退化为协作连接/会话层。
11. 登录只用于保存用户资料，不作为 Workspace 创建、分享或协作的前置条件。
12. Worker 只负责分享链接登记、连接协调和不透明消息转发，不理解业务载荷。

### 1.1 Workspace 入口与路由

- 主导航中的 Image Workspace 直接进入 `/workspace`。
- 进入 Workspace 不创建 Workspace，也不要求先建立协作会话。
- Workspace 页面必须在没有 Workspace 的情况下独立完成图片添加、处理、审阅和下载。
- 主 Workspace 页面不展示 Workspace ID、创建 Workspace、复制 Workspace 链接、最小化 Workspace 或离开 Workspace 等入口。
- `/workspace` 始终进入当前设备自己的本地 Workspace。
- `/workspace/{share_token}` 进入对应的共享 Workspace；未登录用户以访客身份加入。
- `/share?workspaceId=...` 仅作为旧分享链接的兼容入口，不属于 3.0 主产品流程。

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
    │   └── Workspace Share
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

### 2.1 数据所有权

| 数据 | 保存位置 | Worker 职责 |
| --- | --- | --- |
| 登录用户资料 | D1 | 提供独立的用户资料接口，不参与 Workspace 准入 |
| Workspace ID、Owner Capability | Owner 本地 | 不读取图片业务状态 |
| Share Token 与路由元数据 | D1 / Durable Object 会话 | 创建、解析、失效和连接路由 |
| 图片原数据、Preview、Source Data | 参与者本地 | 在线时不透明转发，不持久化 |
| Operation、Proposal、Commit、Style | 参与者本地 | 在线时不透明转发，不持久化 |
| Presence 与连接状态 | Durable Object 活跃会话 | 仅保留连接生命周期内状态 |

`owner_capability` 是 Owner 操作凭证，不得出现在分享 URL、日志或协作者消息中。重新生成
Share Link 必须验证该本地凭证；持有 Share Token 只获得 Collaborator 会话角色。

### 2.2 实施依赖顺序

章节按产品能力组织，但开发不能简单按章节编号串行。推荐顺序：

```text
阶段 1-3：Workspace、页面和图片基础
    ↓
阶段 13：先完成 WebSocket 双向通信、通用转发和 WebRTC 切换骨架
    ↓
阶段 4-12：逐项接入协作者、Preview、Source、Proposal、Commit、Style 和缓存
    ↓
阶段 14：收敛完整状态机和恢复行为
```

实时骨架首次验收只测试两个客户端双向通信，不依赖 Workspace UI。

## 3. 第一阶段：Workspace 基础模型

### 3.1 Workspace 生命周期

Workspace 生命周期与登录状态解耦：

```text
首次进入 /workspace
    ↓
创建或恢复本地 Workspace
    ↓
按需创建 Share Link
    ↓
Owner 分享固定链接
    ↓
访客通过链接加入协作会话
```

#### 本地 Workspace

- 可以正常使用图片功能。
- 可以添加、处理图片。
- Workspace ID 是本地数据隔离标识，不作为公开分享地址。
- Owner 的图片、Preview、Source Data、Commit 和 Style 以本地数据为准。
- 登录与否不改变 Workspace 的业务能力。

#### 共享 Workspace

Owner 点击 Create Share Link 后：

```text
Workspace
 ├── workspace_id       # 内部唯一标识
 ├── owner_capability   # 仅保存在 Owner 本地
 ├── share_token        # 对外固定链接标识
 ├── images             # 本地数据
 ├── collaborators      # 会话状态
 ├── commits            # 本地数据
 └── style              # 本地数据
```

分享地址使用独立的 `share_token`：

例如：

`/workspace/share_2338ad6356a03fff2b45dcd88e189fd51a02b0fd0f293150`

- Share Link 默认长期有效，不使用旧共享流程的 30 分钟过期规则。
- Owner 可以主动重新生成链接；新链接生效后旧链接立即失效。
- 重新生成 Share Link 不改变 Workspace ID，也不迁移或删除本地数据。
- 访客无需登录，Worker 不通过 Cookie、用户 Session 或 Realtime Grant 决定能否加入。
- Owner/Collaborator 角色由分享会话能力建立，与登录账号和邮箱无关。

### 3.2 任务

- [x] 定义 Workspace 数据模型。
- [x] 定义本地 Workspace 状态。
- [x] 定义共享 Workspace 状态。
- [x] 保证 Workspace 生命周期与登录状态解耦。
- [x] 定义 Workspace ID。
- [x] 定义 Workspace Owner。
- [x] 定义 Workspace 本地缓存模型。
- [x] 定义 Workspace 创建/恢复流程。
- [x] 定义 Workspace 分享链接模型。
- [x] 实现独立 Share Token 的创建、恢复和重新生成。
- [x] 实现匿名访客加入和 Owner 本地能力恢复。

## 4. 第二阶段：Workspace 页面结构

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

未创建链接：

Create Share Link

已创建链接：

Copy Share Link
Regenerate Share Link

### 4.3 任务

- [x] 新增 `/workspace` 直接入口，且不创建或加入 Workspace。
- [x] 支持本地图片添加、处理、审阅、下载和持久化恢复。
- [x] 显示 Workspace 名称、本地/共享状态、概览和图片统计。
- [x] 完成 Workspace 主布局。
- [x] 完成 Header。
- [x] 完成 Context Panel。
- [x] 完成图片选中状态。
- [x] 完成 Quick Actions。
- [x] 完成 Share Link 创建和复制。
- [x] 完成 Share Link 重新生成及旧链接失效提示。
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

- 协作者看不到该图片的元数据、Placeholder 和 Preview。
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

### 7.4 数据边界

- Owner 首先发送轻量 Placeholder Hash 和 Shared 图片元数据。
- 协作者在 Preview 到达前使用 Placeholder 渲染；长按图片时展示 Preview。
- Preview 只在端到端实时连接中由 Owner 本地发送给当前协作者。
- Preview 可以缓存在参与者本地，但不得写入 D1、R2、KV 或 Durable Object Storage。
- Worker 将 Preview 当作不透明载荷转发，不解析图片消息类型或业务字段。
- Owner 离线且协作者无本地缓存时，明确显示无可用 Workspace 数据。

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

Source Data 必须分块传输并校验请求 ID、分块序号、总分块数、总字节数和内容摘要。
只有完整校验成功后才能写入协作者本地缓存。Worker 不保存 Source Data，也不需要理解
Source Request 或图片分块的业务结构。

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

MVP 首批支持：

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

Proposal 只发送结构化 Operation 和必要元数据，不上传处理后的图片。Worker 只按连接目标
转发不透明载荷；Operation 校验、去重和 Preview 生成均由端侧完成。

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

Style JSON 必须使用受限 schema，不允许注入任意 CSS。Style 由端侧校验、缓存和应用，
Worker 只转发不透明载荷，不承担 Style schema 校验。

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

使用可配置 TTL 和 LRU 策略缓存。

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

所有图片内容缓存都位于参与者设备。Web 使用 IndexedDB/OPFS，Desktop 使用本地数据库
和文件存储；D1 只保存必要的 Worker 服务元数据，不保存 Preview、Source Data、Commit
Snapshot 或 Activity 内容。

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

传输优先级：

1. WebRTC DataChannel。
2. WebRTC 未就绪或失效时回退 Worker WebSocket 不透明转发。

本阶段不使用 R2 保存或转发 Workspace 图片数据。

### 15.4 连接时序

```text
解析 Share Token
    ↓
立即连接线上 Worker WebSocket
    ↓
Presence 与业务消息可以开始传输
    ↓
通过 WebSocket 交换 WebRTC SDP / ICE
    ↓
DataChannel Open + Heartbeat + Test Message ACK
    ↓
排空 WebSocket 可靠消息队列
    ↓
切换到 WebRTC，关闭 WebSocket
```

- WebSocket 必须先连接，不能等待 WebRTC 才展示协作者在线状态。
- RTC 达标必须同时满足 DataChannel 打开、心跳成功和双向测试消息确认。
- RTC 断开、连续心跳失败或发送超时后，立即重连 WebSocket 并恢复消息传输。
- 需要重新协商 RTC 时，通过已恢复的 WebSocket 交换信令，达标后再次切回 RTC。
- 切换前后的可靠事件使用同一 Event ID，接收端去重，不能重复 Apply 或 Commit。
- 浏览器端始终连接线上 `wss://api.picbind.com`，不依赖本地 Worker、跨站 Cookie 或登录 Session。
- TURN 凭证接口允许持有有效 Share Token 的匿名参与者调用，并通过速率限制和短 TTL 防滥用。

### 15.5 Worker 边界

Worker 只处理稳定的传输信封，例如连接 ID、目标 ID、消息 ID 和二进制载荷；新增
Preview、Source Data、Proposal 或后续业务消息时，不应修改 Worker 的业务分支。
Worker 不持久化实时载荷，也不代理 OAuth 头像或 Workspace 图片。

### 15.6 任务

- [x] 定义 Presence。
- [x] 定义 Collaboration Event。
- [x] 定义 Event ID。
- [x] 定义 Sequence。
- [x] 定义数据可靠性等级。
- [x] 实现匿名 WebSocket 握手，不依赖 Cookie、Session 或 Realtime Grant。
- [x] 实现通用文本/二进制不透明转发协议。
- [x] 接入 WebRTC。
- [x] 实现 WebSocket 优先连接和 WebRTC 后台协商。
- [x] 实现 RTC 达标检测和 WebSocket 安全切换。
- [x] 实现 RTC 失败后的 WebSocket 自动回退与重新协商。
- [x] 实现 Preview 传输。
- [x] 实现 Source Data 传输。
- [x] 实现 Commit/Event 同步。
- [x] 实现断线重连。
- [x] 实现状态恢复。

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

## 17. 后续产品规范与测试

产品边界、MVP 范围、数据关系和完整用户工作流已迁移至：

- [`PicBind-3.0-image-workspace-product-spec.md`](./PicBind-3.0-image-workspace-product-spec.md)

该产品规范中的旧登录绑定、成员权限或以 Workspace ID 作为分享地址的描述不再适用；
如有冲突，以本文的匿名访问、独立 Share Token 和端侧数据所有权原则为准，后续应单独
同步该规范。

主实施方案第 1-14 阶段的 Workspace 功能测试案例见：

- [`PicBind-3.0-image-workspace-plan-test-cases.md`](./PicBind-3.0-image-workspace-plan-test-cases.md)

这些内容用于约束产品范围和验收，不作为新的代码实施阶段。

## 18. 阶段完成标准

每个阶段只有同时满足以下条件才可以勾选任务：

1. 代码已进入对应的 `apps`、`packages`、`crates` 或 `services` 职责目录。
2. 阶段相关单元测试、协议测试或本地存储测试通过。
3. 实时阶段至少使用两个独立客户端完成双向通信测试，不要求 UI 参与协议测试。
4. 匿名访客、Owner 离线、断线重连、重复事件和无缓存进入等失败路径已验证。
5. Worker 新增业务数据类型时不需要新增消息解析分支。
6. Preview、Source Data 和版本图片未写入 D1、R2、KV 或 Durable Object Storage。
7. Web 与 Desktop 的本地存储实现遵守相同业务契约。
8. 已按测试案例完成自测，并对本阶段改动执行一次代码 Review。
