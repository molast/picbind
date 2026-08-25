# PicBind 3.0 Workspace Realtime V2 实施计划

## 1. 最终边界

Workspace realtime 与登录权限完全独立；登录生命周期负责默认 Workspace 的预创建和恢复。

- 邮箱注册/登录、Google/GitHub OAuth、Session 恢复会确保用户存在一个默认 Workspace。
- 认证响应返回该默认 Workspace 与 Owner Capability，客户端据此恢复同一个本地 Workspace。
- `user_default_workspaces` 仅是用户默认 Workspace 的一对一初始化映射，不是成员或 realtime 权限表。
- Workspace 不保存 `owner_id`，不保存成员关系，也不读取用户 Session。
- `/workspace` 以 Owner 模式打开本地当前 Workspace。
- `/workspace/{share_id}` 以 Guest 模式打开分享 Workspace。
- 未登录用户可以创建 Workspace、打开分享链接并建立实时连接。
- realtime 连接不读取登录状态；退出登录和 Session 过期不会中断当前连接。
- `Workspace ID` 是内部稳定标识；`share_id` 是可重新生成的固定分享链接标识。
- D1 只保存 Workspace 标识、分享链接、名称和时间字段，不保存图片预览或图片源数据。
- Worker 只负责连接建立、WebRTC 信令和通用消息转发，不理解 Workspace 业务事件。

Owner 与 Guest 是当前 Workspace 页面和实时连接中的角色，不是用户账号权限。

## 2. 数据模型

迁移 `0007_decouple_users_from_workspaces.sql` 将 Workspace 调整为独立业务记录：

```text
workspaces
  id
  share_id
  name
  created_at
  updated_at
```

迁移同时删除：

- `workspaces.owner_id`
- `workspaces.is_default`
- `workspace_members`

用户表、登录凭据、OAuth Identity 和 Auth Session 只服务用户资料登录。

迁移 `0009_user_default_workspaces.sql` 新增一对一初始化映射：

```text
user_default_workspaces
  user_id
  workspace_id
  owner_capability
  created_at
  updated_at
```

该表用于认证时幂等预创建和客户端恢复默认 Workspace，不参与分享链接访问、
Owner realtime ticket 或协作者 realtime ticket 的权限判断。

## 3. Worker API

### 3.1 用户资料接口

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
POST /api/auth/exchange
GET  /api/auth/oauth/{provider}/start
GET  /api/auth/oauth/{provider}/callback
```

成功的认证响应包含用户资料和一个默认 Workspace：

```json
{
  "authenticated": true,
  "user": {},
  "workspaces": [
    {
      "id": "...",
      "shareId": "...",
      "name": "My Workspace",
      "ownerCapability": "...",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

响应不得包含 Realtime Grant；realtime 仍通过短期 Ticket 和独立 Capability 建立。

### 3.2 Workspace 接口

```text
POST /api/workspaces
GET  /api/workspaces/{workspace_id}
POST /api/workspaces/{workspace_id}/share-link
POST /api/workspace-links/{share_id}/join
GET  /api/workspaces/{workspace_id}/ice-servers
POST /api/workspaces/{workspace_id}/realtime-ticket
POST /api/workspace-links/{share_id}/realtime-ticket
GET  /api/workspaces/{workspace_id}/realtime-v2
```

这些接口不读取 Cookie、Session、用户 ID 或 Workspace membership。

Owner 入口使用内部 Workspace ID 申请 Owner Ticket。Guest 入口使用 `share_id` 申请 Collaborator Ticket。分享链接更新后，旧 `share_id` 的 Join 和 Ticket 请求立即失效，Workspace ID 保持不变。

## 4. Realtime 启动顺序

1. 页面生成并在当前标签页保存随机 `clientId`。
2. Owner 使用 Workspace ID，Guest 使用 `share_id` 请求短期一次性 Ticket。
3. 浏览器立即建立 Worker WebSocket。
4. WebSocket 连通后立即具备成员状态、消息和通用事件转发能力。
5. Worker WebSocket 转发 Offer、Answer 和 ICE Candidate，客户端并行建立 WebRTC。
6. RTC 控制通道和批量通道达到健康要求后，将 RTC 晋升为主传输。
7. Collaborator 可关闭引导 WebSocket；Owner 保留控制连接处理后续加入者。
8. RTC 失败、超时或健康检查不通过时回退 WebSocket。

浏览器 Cookie 策略不会参与以上流程。

## 5. Ticket 约束

Realtime Ticket 是 WebSocket 握手凭据，不是用户权限。

- 使用加密随机值。
- Worker 只在 Durable Object 中保存 Ticket Hash。
- 默认有效期 45 秒。
- 绑定请求 Origin 和 Workspace ID。
- 只能消费一次。
- Guest Ticket 额外绑定签发时的 `share_id`；链接更新后未消费的旧 Guest Ticket 失效。
- Ticket 元数据不包含用户 ID、Auth Session ID 或 membership。

连接内的 `userId` 是由随机 `clientId` 派生的临时参与者 ID，不对应登录用户资料。

## 6. 通用转发

Workspace 业务数据统一放在 `workspaceRelay` 中：

```json
{
  "type": "workspaceRelay",
  "version": 1,
  "route": "workspace",
  "delivery": "reliable",
  "event": {
    "type": "futureWorkspaceFeature"
  }
}
```

Worker 只校验：

- Envelope 版本、路由和投递类型。
- 消息大小和保留的基础设施事件类型。
- 当前连接的临时发送者和 Owner/Collaborator 角色。
- Reliable 消息是否存在在线目标，并返回 ACK/NACK。

Worker 不校验、不解析、不存储内部业务字段。新增预览、占位图、Proposal、Commit、Reaction 或后续事件时，不需要修改 Worker。

## 7. 图片数据规则

- D1 不保存图片预览、Placeholder、缩略图、图片源数据或 Commit 图片数据。
- Owner 连通后先发送 Placeholder Hash 和共享图片快照。
- Guest 先渲染 Placeholder；需要查看时由 Owner 通过实时连接发送预览数据。
- 图片源数据优先走 WebRTC DataChannel。
- WebRTC 不可用时才使用 Worker WebSocket 回退。
- Worker 和 Durable Object 不持久化图片消息。

## 8. 已完成任务

- [x] 用户注册和 OAuth 创建用户时不再创建默认 Workspace。
- [x] AuthState 只包含用户资料，不包含 Workspace 列表。
- [x] 删除 Workspace 与用户的 Owner、默认空间和 membership 数据关系。
- [x] Workspace 创建、Join、分享链接更新和 ICE 接口不依赖登录。
- [x] 删除 Realtime Grant 路由、签名、密钥和前端缓存逻辑。
- [x] Owner 和 Guest 分别通过 Workspace ID 与 `share_id` 获取 Ticket。
- [x] Ticket 不包含用户 Session，且保持短期、Origin 绑定和一次性消费。
- [x] WebSocket V2 不读取 Cookie。
- [x] V1 迁移路由也允许匿名连接。
- [x] Worker 使用通用 `workspaceRelay` 转发未知业务事件。
- [x] 前端 Workspace 状态从 `AuthContext` 拆到独立 `WorkspaceContext`。
- [x] 平台层将 `WorkspaceRepository` 从 `AuthRepository` 拆出。
- [x] Web Workspace API 使用 `credentials: omit`。
- [x] Desktop Workspace API 不发送登录 Bearer。
- [x] Workspace 操作作者使用临时 Workspace 参与者身份，不使用登录用户 ID 或名称。
- [x] 实时错误只影响连接状态，不再弹出登录或授权提示。

## 9. 通讯测试

### 9.1 用户隔离

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| AUTH-ISO-001 | 邮箱注册 | 返回用户资料，不创建 Workspace |
| AUTH-ISO-002 | OAuth Handoff | 返回用户资料，不返回 Workspace 或 Grant |
| AUTH-ISO-003 | 登录或退出 | 当前 Workspace 缓存不变化 |
| AUTH-ISO-004 | 未登录创建 Workspace | 创建成功 |

### 9.2 分享链接

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| LINK-001 | 匿名打开有效 `share_id` | 返回对应 Workspace |
| LINK-002 | 把 Workspace ID 当作分享 ID | 返回 404 |
| LINK-003 | 重新生成分享链接 | Workspace ID 不变，`share_id` 改变 |
| LINK-004 | 使用旧分享链接 Join/Ticket | 返回 404 |
| LINK-005 | 使用新分享链接 | Join 和 Ticket 成功 |

### 9.3 Ticket 与 WebSocket

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| RT-001 | 无 Cookie、Session、Grant 获取 Owner Ticket | 成功 |
| RT-002 | 无 Cookie、Session、Grant 获取 Guest Ticket | 成功 |
| RT-003 | Ticket 重复消费 | 第二次失败 |
| RT-004 | Ticket 过期 | 连接失败 |
| RT-005 | Origin 不一致 | 连接失败 |
| RT-006 | 缺少 Ticket，仅带 Cookie | 不能升级 V2 WebSocket |
| RT-007 | 匿名 V1 WebSocket | 可在迁移期连接 |

### 9.4 通讯

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| COM-001 | Owner 先连接，Guest 后连接 | 双方收到在线成员状态 |
| COM-002 | Owner 发送 Placeholder | Guest 收到完整通用事件 |
| COM-003 | Owner 发送 Preview | Guest 收到预览数据 |
| COM-004 | Guest 发送未知未来事件 | Worker 转发给 Owner，无需新增业务分支 |
| COM-005 | Guest 发送 WebRTC Offer/ICE | Owner 收到信令 |
| COM-006 | Reliable 消息无目标 | 发送端收到 NACK |

## 10. 自测与 Review

提交前必须通过：

```bash
cd services/cloudflare-worker
pnpm run test
pnpm run test:worker
pnpm run check

cd ../dioxus
cargo fmt --all -- --check
cargo test -p picbind-domain --lib
cargo test -p picbind-app --lib
cargo test -p picbind-ui --lib
cargo check -p picbind-dioxus-web
cargo check -p picbind-platform-desktop
```

Review 必查项：

- Auth 响应和前端 AuthState 没有 Workspace 字段。
- Workspace Worker 路由没有调用 `currentSession()`。
- Workspace 客户端请求没有发送 Cookie 或登录 Bearer。
- Workspace Ticket 没有 Auth Session 和 membership 字段。
- Guest 链接失效后不能再签发或消费旧 Guest Ticket。
- Worker 不保存图片、预览和业务事件。
- WebSocket 先连，RTC 达标后晋升，失败能够回退。

## 11. 部署顺序

本次包含 D1 结构变更，发布顺序固定为：

1. 备份并执行 `0007_decouple_users_from_workspaces.sql`。
2. 部署 Worker。
3. 验证匿名创建、Join、Ticket 和双端 WebSocket 通讯。
4. 发布前端。

不得先发布依赖新表结构的 Worker。迁移会永久删除 Workspace 与用户的历史关联，执行生产迁移前必须确认备份可用。
