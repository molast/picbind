# PicBind 3.0 Image Workspace 产品规范

本文档承接 [`PicBind-3.0-image-workspace-plan.md`](./PicBind-3.0-image-workspace-plan.md) 第十四阶段之后的产品约束。这些内容用于限定产品范围，不作为新的代码实施阶段。

配套测试案例见 [`PicBind-3.0-image-workspace-plan-test-cases.md`](./PicBind-3.0-image-workspace-plan-test-cases.md)。

## 1. 权限与 Owner 模型

3.0 第一版不实现复杂 RBAC，只保留 `Owner` 和 `Collaborator`。

### 1.1 Owner

- 持有 Workspace 最新状态和 Source Data。
- 处理 Proposal Review 和 Commit。
- 管理 Workspace Style 和分享入口。

### 1.2 Collaborator

- 浏览 Shared 图片并请求 Source Data。
- 创建 Operation 和 Proposal。
- 查看 Activity、发送消息和 Quick Reaction。
- 不能直接覆盖 Owner 的最终图片状态。

第一版不加入 Admin、Editor、Reviewer、Viewer 或 Permission Matrix。

## 2. 前端实施顺序记录

以下 Sprint 是已实施能力的组织方式，不是后续待办阶段：

1. Workspace：数据模型、页面、Image List、Context Panel、分享和登录绑定。
2. Image Collaboration：Image Share、Preview 同步、Preview Cache 和协作者图片列表。
3. Collaboration Panel：Collaborators、Presence、Activity、Quick Reactions 和 Messages。
4. Source Data：请求、Owner 审批、Source Cache 和 Owner Offline。
5. Operation / Proposal：Crop、Adjust、Proposal Preview 和 Submit。
6. Review / Commit：Apply、Reject、Defer、Commit 广播和 New Version。
7. Conflict：`base_commit_id`、冲突检测、Merge Review 和 Deferred Proposal。
8. Workspace Style：Style JSON、Editor、Header、Gradient、Typography 和同步。
9. Offline / Recovery：Local Cache、Reconnect、State Recovery 和 Sync Recovery。

## 3. 第一版 MVP 范围

第一版包含：

- Image List 和 Context Panel。
- Workspace Share 和 Image Share。
- Preview Sync 和 Collaboration Panel。
- Collaborators、Activity 和 Message。
- Source Request 和 Source Data Cache。
- Crop / Adjust Operation 和 Proposal。
- Owner Apply / Reject / Defer。
- Commit、New Version 和基础 Rollback。

第一版暂缓：

- 自动 Merge。
- 复杂权限和多层角色。
- 分支和高级版本管理。
- 复杂批处理协作。
- 复杂评论系统。

## 4. 核心数据关系

```text
User
 └── Workspace
      ├── Image
      │    ├── Preview
      │    ├── Source
      │    └── Commit
      ├── Collaborator
      ├── Activity
      ├── Proposal
      │    └── Operation
      └── Style
```

```text
Image
  ↓
Current Commit
  ↓
Proposal.base_commit_id
  ↓
Owner Review
  ↓
Commit
```

Preview、Source Data 和 Commit Snapshot 只保存在用户本地设备或在线端到端传输过程，不写入 D1、R2、KV 或 Durable Object Storage。D1 只保存用户、Workspace、成员关系等服务端业务数据。

## 5. 最终用户工作流

### 5.1 Owner

```text
进入 Workspace
  ↓
添加并选择图片
  ↓
Share Image
  ↓
协作者收到 Preview 并请求 Source
  ↓
Owner Accept
  ↓
协作者提交 Proposal
  ↓
Owner Preview / Apply
  ↓
生成并广播 Commit
```

### 5.2 Collaborator

```text
进入 Workspace
  ↓
连接 Owner 并同步状态
  ↓
查看 Shared Preview
  ↓
Request Source / 等待审批
  ↓
本地处理并生成 Proposal
  ↓
Submit / 等待 Review
  ↓
接收 Apply / Reject / Defer 和新版本
```

## 6. 产品原则

Image Workspace 的核心闭环是：

```text
Select
  ↓
Share
  ↓
Collaborate
  ↓
Propose
  ↓
Review
  ↓
Commit
  ↓
Update
```

Message 和 Reaction 只承担沟通，不参与 Proposal、Commit 或图片状态计算。Owner 始终是最新 Workspace 状态和 Source Data 的 Source of Truth。
