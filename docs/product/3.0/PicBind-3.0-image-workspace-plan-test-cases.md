# PicBind 3.0 Image Workspace 实施方案配套测试案例

本文档是 [`PicBind-3.0-image-workspace-plan.md`](./PicBind-3.0-image-workspace-plan.md) 的配套测试文档。测试范围、预期行为和数据边界均以该实施方案第 1-14 阶段为依据，不测试实施方案之外的扩展能力。

权限、MVP、数据关系和用户工作流等非测试内容见 [`PicBind-3.0-image-workspace-product-spec.md`](./PicBind-3.0-image-workspace-product-spec.md)。

## 1. 测试范围与环境

### 1.1 测试环境

- Web 端连接已部署的线上 Worker，不启动本地 Worker。
- 准备两个独立浏览器上下文，分别作为匿名 Owner 和匿名 Collaborator；登录状态不影响测试结果。
- 准备 PNG、JPEG、WebP、AVIF 图片，其中至少一张包含 Alpha 透明通道。
- 浏览器支持 IndexedDB、WebSocket 和 WebRTC DataChannel。
- 测试 Worker 仅用于 Share Token 路由、Owner Capability 校验、实时转发和 WebRTC 信令。

### 1.2 优先级

- `P0`：核心闭环或数据安全，发布前必须通过。
- `P1`：主要功能和恢复能力，版本验收必须通过。
- `P2`：界面反馈、兼容和边界行为。

### 1.3 通用验证规则

- 每个 Workspace 的本地图片、缓存和版本数据必须隔离。
- Private 图片不得发送 Preview 或 Source Data。
- 未经 Owner 接受，Collaborator 不得覆盖 Owner 图片。
- Preview、Source Data 和 Commit Snapshot 不得出现在服务端持久化存储中。
- Owner Offline 时允许查看有效本地缓存，但不得伪装为最新在线状态。

### 1.4 主实施方案追踪矩阵

| 主文档阶段 | 测试范围 | 对应案例 |
| --- | --- | --- |
| 第一阶段：Workspace 基础模型 | 本地/共享 Workspace、Owner Capability、独立 Share Token、本地隔离 | `WS-001` - `WS-006` |
| 第二阶段：Workspace 页面结构 | Header、Image List、Context Panel、Quick Actions | `WS-007` - `WS-008` |
| 第三阶段：图片模型与状态 | Private、Shared、Working、Reviewing、Committed | `IMG-001` - `IMG-004`、`IMG-007`、`SYN-011` |
| 第四阶段：协作者系统 | Collaborators、Presence、Activity、Reaction、Message | `COL-001` - `COL-006` |
| 第五阶段：Preview 协作同步 | Share 后发送、更新、缓存与恢复 | `IMG-001` - `IMG-006` |
| 第六阶段：Source Data 请求 | Request、Accept、Reject、传输、缓存、Owner Offline | `SRC-001` - `SRC-008` |
| 第七阶段：Operation / Proposal | Operation、base commit、Preview、Submit | `PRP-001` - `PRP-005`、`PRP-010` |
| 第八阶段：Owner Review | Apply、Reject、Defer、Pending Review | `PRP-006` - `PRP-010` |
| 第九阶段：Commit / 版本 | Commit、广播、New Version、History、Rollback | `CMT-001` - `CMT-007` |
| 第十阶段：并发与 Merge | 冲突检测、Merge Review、人工覆盖 | `CMT-008` - `CMT-010` |
| 第十一阶段：Workspace Style | Schema、Editor、同步、缓存和权限 | `STY-001` - `STY-006` |
| 第十二阶段：本地缓存 | Workspace 隔离、恢复、TTL、Offline UI | `WS-002`、`WS-006`、`IMG-006`、`SRC-006` - `SRC-008`、`CMT-006`、`SYN-009` |
| 第十三阶段：WebRTC / 同步层 | 可靠事件、去重、重连、DataChannel 和回退 | `SYN-003` - `SYN-010`、`SYN-012` |
| 第十四阶段：Workspace 状态机 | Workspace、Image、Proposal、Commit 合法转换 | `IMG-007`、`PRP-005` - `PRP-008`、`SRC-008`、`SYN-001`、`SYN-002`、`SYN-005`、`SYN-011` |

## 2. Workspace 基础与页面测试（第一、二阶段）

| ID | 优先级 | 测试场景 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- | --- |
| WS-001 | P0 | 未登录进入 Workspace | 清除登录态后打开 `/workspace` | 直接创建或恢复当前设备的本地 Workspace，不创建 Workspace，不要求登录 |
| WS-002 | P0 | 本地 Workspace 添加图片 | 上传合法图片并刷新页面 | 图片可处理且从当前 Workspace 本地缓存恢复 |
| WS-003 | P0 | 登录状态解耦 | 本地 Workspace 有图片时登录、退出并重新进入 | Workspace ID、图片和业务能力均不因登录状态改变 |
| WS-004 | P0 | Owner Capability 隔离 | 创建分享链接后只复制 Share URL 到另一个浏览器 | Share URL 不包含 Capability；访客不能读取 Owner 详情、重建链接或签发 Owner Ticket |
| WS-005 | P0 | 固定分享链接 | Owner 创建 Share Link，再由另一浏览器打开 | 链接包含独立 `share_token` 而非 `workspace_id`，未登录访客可加入 |
| WS-006 | P1 | Workspace 切换隔离 | 在两个 Workspace 分别添加不同图片并来回切换 | 每个 Workspace 只恢复自己的图片、Style、Activity 和 Commit |
| WS-007 | P1 | 页面结构 | 分别在无选中图片和选中图片时检查页面 | Header、Image List、Context Panel、Quick Actions 和 Share 区域状态正确 |
| WS-008 | P2 | 图片上下文 | 选择不同格式和尺寸的图片 | 名称、尺寸、格式、大小、协作状态和 Current Commit 正确更新 |

## 3. 图片状态与 Preview 测试（第三、五阶段）

| ID | 优先级 | 测试场景 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- | --- |
| IMG-001 | P0 | Private 默认状态 | Owner 添加新图片，Collaborator 保持在线 | 图片默认为 Private，Collaborator 不收到 Preview |
| IMG-002 | P0 | Share Image | Owner 对 Private 图片执行 Share | 状态变为 Shared，Collaborator 收到受限 Preview 和占位信息 |
| IMG-003 | P0 | Unshare Image | Owner 对 Shared 图片执行 Unshare | Collaborator 收到移除事件；无 Source 的远端 Preview 被移除 |
| IMG-004 | P1 | Unshare 后保留已获 Source | Collaborator 已缓存 Source 后由 Owner Unshare | 本地 Source 可保留为 Private/Library 数据，但不再作为在线 Shared 图片 |
| IMG-005 | P1 | Preview 更新 | Owner 更新已分享图片的 Preview | Collaborator 收到更高版本 Preview，旧 Object URL 被释放 |
| IMG-006 | P1 | 重新进入恢复 Preview | Collaborator 收到 Preview 后刷新页面 | 先从本地缓存恢复，再由在线快照校正，不出现空白右侧面板 |
| IMG-007 | P2 | 旧状态兼容 | 使用包含 `collaborationState: "updated"` 的旧缓存启动 | 缓存成功读取为 `Committed`，新写入值为 `committed` |

## 4. Collaboration Panel 测试（第四阶段）

| ID | 优先级 | 测试场景 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- | --- |
| COL-001 | P1 | 成员在线状态 | Owner 与 Collaborator 先后进入和离开 | Collaborators 列表正确显示加入、在线和离开 |
| COL-002 | P1 | 当前操作 Presence | Collaborator 选择、处理或审阅图片 | Owner 看到对应图片和当前操作，状态不会改变图片业务结果 |
| COL-003 | P1 | Activity 派生 | Owner Share 后再 Unshare 图片 | 生成结构化 Activity，顺序和操作者正确 |
| COL-004 | P2 | Quick Reaction | 双方分别发送多种 Reaction | 对方实时收到；Reaction 不修改图片、Proposal 或 Commit 状态 |
| COL-005 | P1 | Message | 双方发送普通消息 | 消息实时展示；消息内容不触发业务状态转换 |
| COL-006 | P2 | Activity 缓存上限 | 构造超过 50 条或超过 30 天的 Activity | 只恢复最近 30 天且最多 50 条 |

## 5. Source Data 测试（第六阶段）

| ID | 优先级 | 测试场景 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- | --- |
| SRC-001 | P0 | 请求 Source | Collaborator 对 Shared Preview 点击 Request Source | Owner 收到包含请求者和图片信息的审批弹窗 |
| SRC-002 | P0 | Owner Accept | Owner 同意 Source Request | Source 分块完整传输，Collaborator 本地缓存原图和 Current Commit |
| SRC-003 | P0 | Owner Reject | Owner 填写原因并拒绝 | Collaborator 收到拒绝原因，不写入 Source Cache，可重新请求 |
| SRC-004 | P0 | Private 图片请求保护 | 尝试对 Private 或已 Unshare 图片构造请求 | 客户端不发送或 Owner/Worker 拒绝，不传输任何图片字节 |
| SRC-005 | P0 | 分块完整性 | 丢失、重复或篡改一个 Source Chunk | 不组装不完整 Source，不覆盖已有图片，清理请求状态 |
| SRC-006 | P1 | Source 本地恢复 | 成功接收 Source 后刷新页面 | 按当前 Workspace 恢复为 Received 图片，可本地处理 |
| SRC-007 | P0 | Owner Offline | Owner 离线后 Collaborator 请求 Source | 页面显示 Owner Offline/Unavailable，禁止新请求，已有缓存仍可查看 |
| SRC-008 | P1 | 新版本 Source 更新失败 | 更新 Commit 时拒绝请求或中断传输 | 停止 Applying 状态，允许关闭弹窗或重试，旧本地版本不被覆盖 |

## 6. Operation、Proposal 与 Review 测试（第七、八阶段）

| ID | 优先级 | 测试场景 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- | --- |
| PRP-001 | P0 | 生成 Proposal | Collaborator 对 Received 图片执行 Crop/Adjust | 生成本地 Preview 和结构化 Operation，携带稳定 `base_commit_id` |
| PRP-002 | P0 | Proposal 不上传结果图 | 提交 Proposal 并检查实时载荷 | 只发送 Proposal 和 Operation 参数，不发送处理后图片字节 |
| PRP-003 | P0 | Proposal 归属校验 | 篡改 workspace、author、image 或 operation 归属 | Owner 端拒绝非法 Proposal，不进入 Pending Review；Worker 不解析业务内容 |
| PRP-004 | P1 | 重复 Proposal | 使用相同 `proposal_id` 重复提交 | Owner 只保留一条 Pending Proposal |
| PRP-005 | P1 | 提交失败重试 | 提交时断开连接，再恢复并重试 | 状态为 Failed 后可重试，成功后进入 Pending |
| PRP-006 | P0 | Owner Apply | Owner 查看 Preview 并 Apply 合法 Proposal | Owner 图片更新，Proposal 变为 Applied，并生成 Commit |
| PRP-007 | P0 | Owner Reject | Owner 输入原因后 Reject | Owner 图片不变，Collaborator 收到原因，Proposal 变为 Rejected |
| PRP-008 | P1 | Owner Defer | Owner 对 Proposal 选择 Defer | 图片不变，Proposal 保留在 Pending Review，Collaborator 收到 Deferred |
| PRP-009 | P1 | Owner 正在处理 | Owner 处理同一图片时收到 Proposal | Proposal 进入 Pending，不抢占 Owner 当前处理界面 |
| PRP-010 | P0 | 非法 Operation 参数 | 提交越界 Crop、非法尺寸或不支持操作 | Preview/Apply 被阻止并显示明确错误，不改变 Owner Source |

## 7. Commit、冲突与版本测试（第九、十阶段）

| ID | 优先级 | 测试场景 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- | --- |
| CMT-001 | P0 | 首次 Commit | 对无正式 Commit 的图片 Apply Proposal | 创建 Commit，补充 Initial Version，Current Commit 指向新 Commit |
| CMT-002 | P0 | 线性父子关系 | 连续 Apply 两个基于当前版本的 Proposal | 后一 Commit 的 `parent_commit_id` 指向前一 Commit |
| CMT-003 | P0 | Commit 广播 | Owner Apply 后观察 Collaborator | 只广播 Commit 元数据，显示 New Version，不自动覆盖本地 Source |
| CMT-004 | P0 | Update 新版本 | Collaborator 点击 Update，Owner Accept | 重新请求 Source，完成后才替换本地版本并更新 Current Commit |
| CMT-005 | P1 | Review Later | Collaborator 对新版本选择稍后处理 | 弹窗关闭，版本仍保留在 Collaboration Panel |
| CMT-006 | P1 | 历史版本限制 | 单图创建超过 20 个 Commit Snapshot | 本地只保留最近 20 个有效版本 |
| CMT-007 | P1 | Rollback | Owner 选择历史版本并执行 Rollback | 恢复历史字节，但创建新的 Rollback Commit，不改写旧历史 |
| CMT-008 | P0 | 版本冲突 | Owner 先产生新 Commit，再收到基于旧 Commit 的 Proposal | 进入 Conflict/Merge Review，不按普通 Proposal 直接 Apply |
| CMT-009 | P0 | 冲突 Apply | Owner 明确 Apply 冲突 Proposal | 新 Commit 父节点为当前 Commit，`merge_parent_commit_ids` 记录旧基础版本 |
| CMT-010 | P1 | 基础快照缺失 | 删除或过期 Proposal 基础版本后打开 Merge Review | 明确提示无法生成 Proposal Version，并禁止 Apply |

## 8. Workspace Style 测试（第十一阶段）

| ID | 优先级 | 测试场景 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- | --- |
| STY-001 | P1 | Style 编辑与预览 | Owner 修改背景、方向、文字、字体、字号和字重 | Preview 实时更新，保存后 Header 应用，revision 单调增加 |
| STY-002 | P1 | Style 取消与重置 | 修改后 Cancel，再执行 Reset | Cancel 恢复已保存值；Reset 恢复合法默认 Style |
| STY-003 | P0 | Style 输入校验 | 输入非法颜色、字号、字重或空标题 | 禁止保存，不注入任意 CSS |
| STY-004 | P1 | Style 实时同步 | Owner 保存 Style，Collaborator 在线 | Collaborator 接收更高 revision 并更新本地缓存 |
| STY-005 | P1 | Style 所有权 | Collaborator 打开 Workspace Settings | 只能查看；Owner 端忽略协作者伪造的 Style 修改，Worker 不解析 Style |
| STY-006 | P1 | Style 不创建 Commit | Owner 连续保存 Style | 图片 Current Commit 和版本历史不改变 |

## 9. 缓存、同步与状态机测试（第十二至十四阶段）

| ID | 优先级 | 测试场景 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- | --- |
| SYN-001 | P0 | 首次实时连接 | Collaborator 打开固定 Share Token 链接 | WebSocket 先连接，状态按 Connecting、Connected、Syncing、Available 推进，同时后台协商 WebRTC |
| SYN-002 | P0 | Owner 离线与恢复 | Owner 断开后重新上线 | Collaborator 进入 OwnerOffline；上线后先 Syncing，收到快照后 Available |
| SYN-003 | P0 | 连接断线重连 | 中断当前传输后恢复 | RTC 失效时立即恢复 WebSocket；可靠队列和状态快照恢复，并重新协商 RTC |
| SYN-004 | P0 | 可靠事件去重 | 重发相同 `eventId` 的 Proposal/Commit | 接收端只处理一次并正常 ACK |
| SYN-005 | P1 | Sequence Gap | 跳过一个发送端 sequence | Collaborator 进入 Syncing 并发送 `stateRequest`，快照后恢复 Available |
| SYN-006 | P1 | WebRTC 安全切换 | DataChannel 打开并完成心跳和双向测试 ACK | 排空 WebSocket 可靠队列后切换至 DataChannel，并关闭 WebSocket |
| SYN-007 | P0 | WebRTC 回退 | 阻止 DataChannel 建立后发送 Preview/Source | 自动回退线上 Worker WebSocket，业务结果一致 |
| SYN-008 | P1 | TURN 获取失败 | 模拟 TURN 凭证接口失败 | 回退 Cloudflare STUN，不泄露长期凭证 |
| SYN-009 | P0 | 缓存 TTL | 构造过期 Preview、Source、Commit 和 Activity | 按 30/90/30/30 天规则清理；Owner 本地 Source 不自动过期 |
| SYN-010 | P0 | 服务端无图片持久化 | 完成 Preview、Source、Proposal、Commit 全流程后检查存储 | D1/R2/KV/DO Storage 中不存在图片字节、Preview 或 Commit Snapshot |
| SYN-011 | P1 | 非法状态转换 | 对 Private 图片直接 Commit，或对终态 Proposal 再 Reject | 状态机拒绝转换，原状态和数据保持不变 |
| SYN-012 | P1 | 资源释放 | 重复更新 Preview、关闭 Preview、完成 Source 和离开页面 | 旧 ImageBitmap、Blob URL、DataChannel/Worker 相关临时资源被释放 |

## 10. 自动化验收记录

执行日期：2026-08-19。

| 验证范围 | 结果 | 覆盖阶段 |
| --- | --- | --- |
| Workspace 策略、协议、仓储、Source 分块与状态机测试 | 18/18 通过 | 第一、三、五至十、十二至十四阶段 |
| Web 图片存储契约测试 | 4/4 通过 | 第一、五、六、九、十二阶段 |
| Desktop 原生存储测试 | 8/8 通过 | 第一、五、六、九、十二阶段 |
| Core、Network、Protocol、Storage Rust 测试 | 17/17 通过 | 第一、三、四、七至十、十二至十四阶段 |
| Worker 双客户端、匿名 Ticket、固定 Share Token、不透明文本/二进制转发测试 | 24/24 通过 | 第一、四至六、十三阶段 |
| UI 与 Web TypeScript 检查 | 通过 | 第二至十四阶段 |
| Worker dry-run | 通过，Workspace 实时载荷不写入 D1、R2、KV 或 DO Storage | 第一、五、六、九、十三阶段 |
| Next 生产构建与静态导出 | 通过，`/workspace` 路由已生成 | 第二至十四阶段 |
| Rust 格式与 Git diff 检查 | 通过 | 全部阶段 |

Worker 集成测试使用两个独立 WebSocket 客户端完成双向文本、二进制和 WebRTC
信令通信，并检查 Durable Object Storage 只包含短期 Ticket 元数据。浏览器 UI 的跨浏览器
交互仍按本文件案例作为部署前人工验收，不要求启动本地 Worker。

## 11. 发布验收标准

发布前必须满足：

- 所有 `P0` 案例通过。
- `P1` 案例不存在影响主流程或数据一致性的失败。
- Rust 单元测试、Workspace 编译和 Web/WASM 编译通过。
- Owner 与 Collaborator 至少完成一次跨浏览器完整闭环。
- WebRTC 正常路径和 WebSocket 回退路径各完成一次 Source Data 传输。
- 确认 Worker、D1、R2、KV 和 Durable Object Storage 未持久化图片协作数据。
- 确认整个 Workspace 流程不依赖 Cookie、登录 Session、成员记录或 Realtime Grant。
- 未通过的 `P2` 案例需要记录影响范围和后续处理计划。
