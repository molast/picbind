# PicBind Messaging Service 当前架构与实现

> 本文档是 `sdk/room` 消息服务的唯一设计与实现说明。内容只描述当前仓库已经实现的
> 行为；历史上的公众号 Webhook、独立 Node Gateway、Docker 服务和通用第三方微信
> Bot 方案均已废弃。

| 项目 | 当前值 |
| --- | --- |
| 文档版本 | 3.0 |
| 接入渠道 | 腾讯 iLink Bot API（个人微信 Bot） |
| 服务端运行时 | Cloudflare Worker + Durable Object |
| 浏览器实时通道 | Durable Object Hibernation WebSocket |
| 临时媒体存储 | Cloudflare R2 |
| 已实现消息 | 文本双向、图片双向 |
| 当前 Provider | `WeixinIlinkProvider` |

## 1. 当前能力与边界

当前已经实现：

- Room SDK 内的统一消息模型、Provider 接口、事件分发和 Provider 生命周期管理。
- 腾讯 iLink Bot 二维码登录、扫码状态查询和连接恢复。
- 按浏览器 Messaging Client ID 隔离的 Durable Object。
- iLink Bot token、账号信息、同步游标和会话 `context_token` 的服务端持久化。
- Durable Object Alarm 驱动的 `getupdates` 长轮询。
- Hibernation WebSocket 推送连接状态、文本和图片消息。
- 微信文本消息的接收与发送。
- 微信图片的接收、解密、R2 临时存储、本地缓存和发送。
- Room 内微信聊天弹窗、图片列表、图片预览和移入左侧图片库。
- Room 用户与微信 Bot 共存时的分享目标选择。
- 浏览器直传 R2 的进度、失败重试和操作日志。

当前未实现：

- 视频、语音和普通文件的收发。
- Telegram、Discord、Slack 等其他 Provider。
- 微信身份与 PicBind 账号或 Room 的长期服务端绑定。
- 文本聊天记录的本地持久化。
- 多个微信联系人或会话的独立联系人管理界面。

`NormalizedMessageType` 中的 `file` 是扩展预留类型，不代表微信文件消息已经实现。

## 2. 接入边界

当前方案使用：

- 腾讯 iLink Bot API。
- iLink Bot 身份，例如 `...@im.bot`。
- 微信扫码确认连接。
- Durable Object Alarm 发起 iLink `getupdates` 长轮询。
- Browser 到 PicBind Worker 的 Hibernation WebSocket。
- R2 临时承载入站和出站图片。

当前方案不使用：

- 微信公众号或公众号 Webhook。
- 企业微信、自建应用、Wechaty、Gewechat、WCFerry 或 itchat。
- 独立 `messaging-service` Node 进程。
- Docker 运行时。
- 浏览器直接调用 iLink API。
- 浏览器环境变量保存 iLink token、AES Key 或 R2 Secret。
- WebSocket 应用层 `PING/PONG` 心跳。

## 3. 总体架构

```text
微信用户
   |
腾讯 iLink Bot API
   |
Cloudflare Worker
   |
WeixinMessagingObject (Durable Object)
   |-- Durable Object Storage: 账号、游标、上下文和临时对象索引
   |-- Alarm: getupdates 与过期对象清理
   |-- Hibernation WebSocket: 状态、消息和图片发送 RPC
   `-- MESSAGING_MEDIA_R2: 临时图片
   |
Room SDK Messaging Core
   |
Room 聊天、图片库与图片分享流程
```

代码分布：

```text
cloudflare-worker/src/messaging/
|-- ilink-client.ts
|-- weixin-media.ts
|-- weixin-messaging.ts
`-- weixin-messaging-object.ts

sdk/room/src/messaging/
|-- core/
|-- providers/weixin/
|-- providers/mock/
`-- router/

sdk/room/src/components/share/
|-- messaging-service-dialog.tsx
|-- weixin-chat-dialog.tsx
`-- share-room-page.tsx
```

职责边界：

- Worker 负责 iLink 凭证、轮询、媒体加解密、R2 临时对象和受信任 API 调用。
- Messaging Core 负责 Provider 注册、状态订阅和规范化消息分发。
- Room 业务层负责聊天 UI、本地缓存、图片库、分享对象和操作日志。
- 图片编辑、压缩和 Room 实时协作不属于 Messaging Core。

## 4. 身份、隔离与持久化

### 4.1 Messaging Client ID

Browser 首次创建 `IlinkHttpGatewayTransport` 时生成 32 位十六进制 Client ID，并写入：

```text
localStorage["picbind:messaging-client-id"]
```

所有 Messaging HTTP 和 WebSocket 请求都携带 `clientId`。Worker 使用它选择 DO：

```text
WEIXIN_MESSAGING.idFromName(clientId)
```

因此隔离关系为：

```text
Client ID A -> WeixinMessagingObject A -> iLink 账号 A
Client ID B -> WeixinMessagingObject B -> iLink 账号 B
```

Client ID 用于 DO 分区，不是微信凭证。清除浏览器站点数据后会生成新 ID，浏览器将无法
继续定位原 DO 中的连接记录，需要重新扫码；原 DO 数据不会因为清除浏览器缓存而自动
删除。

### 4.2 Durable Object Storage

二维码确认后，iLink 返回的 `ilink_user_id`、`ilink_bot_id` 和 Bot token 被写入当前
`WeixinMessagingObject` 的 Storage。账号记录包含：

- `accountId`
- `token`
- `baseUrl`
- `userId`
- `syncBuffer`
- `contextTokens`
- `savedAt`

DO 还保存：

- 当前运行状态和最近轮询成功时间。
- 尚未结束的二维码登录 Session。
- 五分钟消息去重记录。
- 入站 R2 图片索引。
- 待发送图片上传记录。
- 当前 Client ID。

`/status` 只向 Browser 返回配置状态、连接状态、`accountId`、`userId`、最近成功时间和
错误信息。Bot token、同步游标、上下文 token 和媒体 AES Key 不返回 Browser。

### 4.3 Browser 本地数据

Browser 对微信图片使用：

- OPFS 保存 Blob，路径位于 `cache/messaging/...`。
- Dexie `messagingImages` 表保存文件索引和元数据。
- 最多保留最近 100 张入站或出站微信图片。
- 页面展示使用本地 Blob URL，不持久化 R2 远端 URL。

文本聊天当前只保存在 React 运行时状态中，刷新页面后不会恢复。

## 5. Messaging Core

统一消息模型：

```ts
type NormalizedMessage = {
  id: string;
  channel: "wechat" | "telegram" | "discord" | "slack" | "web" | "mobile";
  senderId: string;
  conversationId: string;
  type: "text" | "image" | "file";
  payload: {
    text?: string;
    fileId?: string;
    downloadUrl?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    expiresAt?: number;
  };
  timestamp: number;
};
```

`MessageProvider` 提供：

- `start()` / `stop()`
- `send()`
- `upload()` / `download()`
- 消息订阅和状态订阅
- Provider 快照读取

`MessagingService` 负责 Provider 注册、生命周期、统一收发和事件分发。单个订阅者抛出
异常不会阻断其他订阅者。

Provider 状态：

| 状态 | 含义 |
| --- | --- |
| `disconnected` | 未启用或主动断开 |
| `connecting` | 已启用，等待首次成功轮询 |
| `connected` | 最近一次 iLink `getupdates` 成功 |
| `error` | iLink 请求或 Session 异常 |

Browser WebSocket 已建立不等于 iLink 已连接，界面以 Worker 推送的
`GATEWAY_STATUS` 为准。

## 6. Worker 接口与 WebSocket 协议

公开前缀：

```text
/api/messaging/weixin
```

HTTP 接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/status` | 查询配置和运行状态 |
| `POST` | `/login` | 创建二维码登录 Session |
| `GET` | `/login/:sessionId` | 查询扫码状态 |
| `POST` | `/connect` | 启用 Alarm 轮询 |
| `POST` | `/disconnect` | 停止消息轮询，保留账号配置 |
| `POST` | `/messages` | 发送文本消息 |
| `GET` | `/files/:fileId` | 刷新图片 URL 或通过 Worker 读取图片 |
| `GET` | `/socket` | WebSocket Upgrade |

WebSocket 下行消息：

- `GATEWAY_STATUS`
- 规范化文本或图片消息
- `REQUEST_RESULT`

WebSocket 上行 RPC：

- `PREPARE_IMAGE_UPLOAD`
- `SEND_IMAGE`

每个 RPC 使用 32 位随机 `requestId` 配对结果。普通 RPC 默认等待 30 秒，图片发送等待
180 秒。

WebSocket 使用 Durable Object Hibernation，不发送应用层心跳。Browser 通过原生
`open`、`close`、`error` 事件维护状态，断线后以 1 秒起步、最高 30 秒的指数退避重连。

## 7. 扫码与长轮询生命周期

扫码流程：

1. Browser 调用 `POST /login`。
2. Worker 调用 iLink `get_bot_qrcode`。
3. Worker 返回二维码内容，Browser 使用 `qrcode` 生成 Data URL。
4. Browser 每 1.5 秒查询一次登录 Session。
5. 用户在微信确认后，Worker 保存账号记录。
6. Worker 将状态设为 `connecting`，设置 Alarm 并开始拉取消息。
7. Room 再次打开时，如果 `/status` 已配置，会自动恢复 Provider 连接。

二维码 Session 默认 8 分钟过期。原始 Bot token 永远不会返回 Browser。

DO 不运行常驻循环。一次 Alarm 执行一次 `getupdates`：

```text
Alarm
  -> 清理过期 R2 对象和待上传记录
  -> 调用一次 getupdates
  -> 保存 syncBuffer 和 contextTokens
  -> 去重并广播规范化消息
  -> 更新连接状态
  -> 安排下一次 Alarm
```

成功后约 100 毫秒安排下一次 Alarm。失败前两次按 2 秒退避，连续第三次及以后按 30 秒
退避。检测到 iLink Session 失效后停止消息轮询并等待重新扫码，但仍会为 R2 清理安排
Alarm。

## 8. 接收微信消息

### 8.1 文本

Worker 从 iLink `item_list` 中提取第一个非空文本项，转换为 `NormalizedMessage` 并通过
WebSocket 广播。`context_token` 按发送者保存，后续回复同一用户时复用。

Room 将真实收发文本显示在消息列表和微信聊天窗口。连接、缓存、传输和图片接收等系统
事件只进入操作日志，不混入手动消息列表。

### 8.2 图片

iLink 图片消息携带 CDN 引用和可能存在的 AES Key，不是可长期使用的公开 URL：

```text
iLink image_item
  -> Worker 构造并校验微信 CDN HTTPS URL
  -> 最多下载 MESSAGING_MAX_MEDIA_SIZE_MB
  -> AES-128-ECB 解密并移除有效 PKCS#7 padding
  -> 检查 JPEG / PNG / GIF / WebP / AVIF 文件签名
  -> 明文写入 MESSAGING_MEDIA_R2
  -> WebSocket 推送 fileId、短期 URL 和元数据
  -> Browser 立即下载 Blob 并写入 OPFS + Dexie
  -> 页面仅使用本地 Blob URL
```

CDN 下载超时为 30 秒。单张图片失败只记录警告，不阻断同一批次后续消息。

下载 URL 失败或过期时，Browser 使用 `fileId` 刷新 URL；R2 直链失败时改用
`proxy=1` 获取 Worker 受控下载地址。链接过期不会立即删除对象，对象由 Alarm 根据
TTL 清理。

## 9. 发送微信消息

### 9.1 文本

Room 使用当前 Provider 的 `recipientId` 作为 `conversationId`，调用 `/messages`。
Provider 初始使用扫码结果中的 `userId`，收到新消息后会更新为该消息的
`conversationId`。Worker 调用 iLink `sendmessage`，并在存在时带上对应
`context_token`。

### 9.2 图片

图片二进制不经过 WebSocket：

```text
Room 图片
  -> WebSocket PREPARE_IMAGE_UPLOAD
  -> Worker 创建当前 Client ID 专属 objectKey 和预签名 PUT URL
  -> Browser 使用 PUT 直传 R2
  -> WebSocket SEND_IMAGE，只发送 objectKey、接收者和图片元数据
  -> Worker 校验待上传记录、TTL、大小、MIME 和真实图片签名
  -> Worker 从 R2 binding 读取明文
  -> AES-128-ECB + PKCS#7 加密
  -> iLink getuploadurl
  -> Worker 上传密文到微信 CDN
  -> iLink sendmessage 发送 image_item
  -> Worker 删除 R2 对象和待上传记录
```

支持 JPEG、PNG、WebP、GIF 和 AVIF。默认单图上限为 20 MB，同一 Client ID 最多保留
8 个待上传记录。待上传记录和出站 R2 对象 15 分钟过期；发送成功或失败都会清理。

iLink 图片发送使用随机 16 字节 AES Key。传给 iLink 的 `aes_key` 是
`base64(hex(aesKey))`，不能改成原始 AES 字节的 Base64。

### 9.3 Browser 到 R2 的失败重试

Room R2 中继和微信图片发送复用 `uploadFileToR2`：

- 总计最多尝试 5 次。
- 网络错误、`408`、`425`、`429` 和 `5xx` 自动重试。
- 用户取消和其他永久性 `4xx` 立即失败。
- 重试延迟从 400 毫秒开始指数增长。
- 每次失败和准备重试分别写入操作日志。
- 重试前进度归零，成功后进度更新为 100%。

## 10. R2 数据与生命周期

入站对象路径：

```text
messaging/weixin/{accountIdHash}/{messageIdHash}/{randomId}
```

出站对象路径：

```text
messaging/outbound/{clientIdHash}/{randomId}
```

默认值：

| 参数 | 默认值 |
| --- | ---: |
| 入站图片大小上限 | 20 MB |
| 入站 R2 对象 TTL | 900 秒 |
| 入站下载 URL TTL | 900 秒 |
| 出站待上传 TTL | 900 秒 |
| 待上传记录上限 | 8 |

`MESSAGING_MEDIA_R2` 与 Room 文件中继使用的 `SHARE_IMAGES_R2` 是两个不同 binding。
当前 Wrangler 配置允许它们指向同一个 bucket，但索引、对象路径和生命周期彼此独立。

图片 Blob 不写入 Durable Object Storage。DO 只保存账号、游标、上下文、去重状态和
R2 对象关联数据。

## 11. Room UI 与业务行为

- 顶部消息服务入口用于扫码、连接、断开和查看 Provider 状态。
- 微信 Bot 在 Room 用户区显示为只支持发送消息的 Bot 用户，不能作为普通 Room 成员。
- 点击 Bot 打开独立聊天弹窗；聊天区显示文本和图片消息，右侧显示图片列表。
- 图片消息气泡只显示图片图标和文件名；点击后定位右侧图片。
- 点击右侧缩略图可在统一预览弹窗中浏览微信图片。
- 入站图片可移入左侧图片库，即使当前没有其他 Room 用户也可进入工作台。
- 向微信分享图片成功后写入微信聊天图片列表，不进入 Room 待发送区。
- 向 Room 用户分享图片继续执行预览、接受或拒绝和正式传输流程。
- 同时存在 Room 用户和微信 Bot 时，分享前必须选择一个目标；只有一个目标时自动展示。
- 浏览器标签页不活跃时，收到文本或图片会触发 Tab 通知。

## 12. 配置与部署

Wrangler 必需绑定：

```toml
[[durable_objects.bindings]]
name = "WEIXIN_MESSAGING"
class_name = "WeixinMessagingObject"

[[r2_buckets]]
binding = "MESSAGING_MEDIA_R2"
bucket_name = "picbind-bucket"

[[migrations]]
tag = "v3"
new_sqlite_classes = ["WeixinMessagingObject"]
```

Worker 变量：

```env
MESSAGING_MEDIA_TTL_SECONDS=900
MESSAGING_MEDIA_URL_TTL_SECONDS=900
MESSAGING_MAX_MEDIA_SIZE_MB=20
MESSAGING_PUBLIC_URL=https://api.picbind.com
R2_BUCKET_NAME=picbind-bucket
R2_ACCOUNT_ID=<cloudflare-account-id>
```

Worker Secrets：

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

Browser 变量：

```env
NEXT_PUBLIC_MESSAGING_GATEWAY_URL=https://api.picbind.com
```

R2 Secret 不得放入 `NEXT_PUBLIC_*` 或 Room SDK 配置。

主 Web 通过 `configureRoomSdk({ messagingService })` 注入服务。Room 独立 Preview 使用
`VITE_MESSAGING_GATEWAY_URL`，未设置时回退到 `VITE_ROOM_API_URL`，再回退到
`https://api.picbind.com`。

## 13. 本地开发

仓库根目录运行：

```bash
./dev-local.sh
```

该脚本只启动 `web` 的开发服务，不启动本地 Worker 或独立 Messaging Service。Room 和
Messaging 始终调用已部署的 Worker，默认地址为：

```text
https://api.picbind.com
```

独立 Room Preview 可在 `sdk/room` 执行 `pnpm dev`，它同样默认调用远端 Worker。
远端 Worker 的 `ALLOWED_ORIGINS` 和 R2 CORS 必须允许对应本地域名。

## 14. 安全与兼容规则

- iLink token、AES Key、R2 Secret、同步游标和上下文 token 只能保存在 Worker 侧。
- Browser 不能指定任意 R2 objectKey；出站 key 必须由当前 DO 创建并存在于待上传记录。
- Worker 必须校验图片声明 MIME、文件大小和真实文件签名。
- 入站 CDN URL 必须使用 HTTPS 且主机位于微信白名单。
- 入站下载、出站微信 CDN 上传必须设置超时和大小限制。
- WebSocket 不承载图片二进制，也不用于应用层心跳或网络质量检测。
- 单个图片解析失败不能终止后续 iLink 消息处理。
- Session 失效后停止快速轮询并要求重新扫码。
- 不同 Messaging Client ID 不共享凭证、游标或媒体索引。
- 本地页面不持久化远端图片 URL，必须在 URL 过期前下载为 Blob。
- 系统事件进入操作日志；只有真实手动文本消息进入消息列表。

## 15. 关键实现文件

Worker：

- `cloudflare-worker/src/index.ts`
- `cloudflare-worker/src/messaging/ilink-client.ts`
- `cloudflare-worker/src/messaging/weixin-media.ts`
- `cloudflare-worker/src/messaging/weixin-messaging.ts`
- `cloudflare-worker/src/messaging/weixin-messaging-object.ts`
- `cloudflare-worker/src/r2-presign.ts`
- `cloudflare-worker/wrangler.toml`

Room SDK：

- `sdk/room/src/messaging/core/message.ts`
- `sdk/room/src/messaging/core/provider.ts`
- `sdk/room/src/messaging/router/dispatcher.ts`
- `sdk/room/src/messaging/providers/weixin/provider.ts`
- `sdk/room/src/messaging/providers/weixin/http-transport.ts`
- `sdk/room/src/components/share/messaging-service-dialog.tsx`
- `sdk/room/src/components/share/weixin-chat-dialog.tsx`
- `sdk/room/src/components/share/share-room-page.tsx`
- `sdk/room/src/database/repositories/messaging-image-repository.ts`
- `sdk/room/src/utils/realtime-r2-transfer.ts`

宿主接入：

- `web/src/utils/messaging-service.ts`
- `web/src/utils/room-sdk.ts`
- `sdk/room/preview/main.tsx`

## 16. 文档维护规则

以下改动必须同步更新本文档：

- 增删消息 Provider 或消息类型。
- 修改 iLink 登录、轮询、状态或 WebSocket 协议。
- 修改 Client ID、DO Storage 或身份隔离方式。
- 修改图片收发、媒体加解密、R2 路径、TTL、上限或重试策略。
- 修改本地缓存、Room 聊天或分享目标行为。
- 修改 Worker binding、环境变量、Secret 或本地开发方式。

未来设计必须明确标为规划，不能写入“当前已实现”章节。
