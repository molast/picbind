# PicBind Messaging Service - 微信 iLink 接入架构

> 本文档描述 PicBind 如何通过腾讯 iLink Bot API 接入个人微信 Bot。
> 设计参考 Hermes Weixin Adapter，但目录、运行方式和职责边界以 PicBind 当前项目为准。

| 项目 | 内容 |
| --- | --- |
| 版本 | 1.2 |
| 状态 | 文本与微信图片入站链路已实现，媒体出站待实现 |
| 接入类型 | 腾讯 iLink Bot API |
| 部署方式 | 独立 Node.js 常驻进程 |

## 1. 当前实现范围

当前仓库已经实现：

- 根目录独立包 `messaging-service`。
- `NormalizedMessage`、`MessageProvider`、事件分发和 Provider 生命周期管理。
- 用于本地验证的 `MockMessageProvider`。
- `WeixinIlinkProvider` 和 `IlinkGatewayTransport` 客户端接口。
- 独立 Node.js Gateway、真实二维码登录和扫码状态轮询。
- iLink 凭证、同步游标和会话 `context_token` 的服务端持久化。
- `getupdates` 长轮询、文本去重、退避重试、文本接收和回复。
- 微信图片 CDN 下载、AES-128-ECB 解密、格式校验、临时存储和 Room 下载。
- Room 独立微信聊天弹窗和收到的图片列表。
- Browser HTTP/SSE Transport，Room 扫码配置与自动连接。
- Room 顶部 Messaging Service 入口、Provider 状态和连接控制。
- 旧名称 `WechatProvider`、`WechatTransport` 的兼容导出。

当前尚未实现：

- 微信图片出站、视频、语音和普通文件收发。
- 微信身份与 PicBind 用户、Room 的持久化绑定。

## 2. 接入范围

本方案使用：

- 腾讯 iLink Bot API。
- iLink Bot 身份，例如 `...@im.bot`。
- 微信扫码登录。
- HTTP 长轮询接收消息。

本方案不使用：

- 微信公众号或公众号 Webhook。
- 企业微信、企业微信自建应用。
- Wechaty、Gewechat、WCFerry、itchat 等逆向个人微信框架。
- 浏览器直接连接 iLink API。
- Cloudflare Worker 承担 iLink 长轮询。

iLink Bot 身份与扫码所用的普通个人微信账号是两个独立身份。私信通常可以可靠
工作；普通微信群是否产生事件由 iLink 账号能力决定，不能由 PicBind 的群策略保证。

## 3. 项目架构

```text
微信用户
   |
腾讯 iLink Bot API
   |
PicBind Weixin Adapter
   |
PicBind Messaging Gateway
   |
PicBind Messaging Core
   |
Room / Image Workflow / Storage
```

对应当前仓库：

```text
pix-wasm/
├── messaging-service/       # Messaging Core、Provider 和 Gateway 客户端契约
├── sdk/room/                # Messaging Service 消费方和连接 UI
├── web/                     # Room SDK 宿主，仅传入公开 Gateway 地址
├── cloudflare-worker/       # Room 实时服务，不负责 iLink 长轮询
├── wasm/                    # 图片处理引擎
└── sdk/wasm/                # Web 可消费的图片处理 SDK
```

Gateway 与浏览器代码保持以下两层边界：

```text
messaging-service/
├── src/                     # 浏览器/Room 可消费的 Core 和类型
└── gateway/                 # 仅服务端运行的 iLink Adapter 与常驻进程
```

服务端代码、iLink token 和 Node 专用依赖不能进入 Room 浏览器产物。

## 4. 六层职责

### Layer 1 - 微信用户层

用户在微信中：

- 添加或打开 PicBind iLink Bot。
- 发送文本、图片或文件。
- 接收处理状态和图片处理结果。

### Layer 2 - iLink Bot 身份层

扫码登录完成后得到：

- `account_id`
- `token`
- `base_url`
- Bot 身份
- Session 信息

这些数据只能保存在 Messaging Gateway 服务端，禁止写入：

- `NEXT_PUBLIC_*` 环境变量。
- Room SDK 配置。
- 浏览器 Local Storage、IndexedDB 或日志。

### Layer 3 - iLink Transport 层

职责：

- 请求登录二维码。
- 等待扫码和手机确认。
- 恢复已保存账号。
- 使用 `getupdates` 进行约 35 秒的 HTTP 长轮询。
- 保存同步游标，重启后从正确位置继续。
- 处理瞬时错误、会话过期和重连。
- 保证同一个 token 只有一个轮询实例。

该层不使用 Webhook 或 WebSocket 连接 iLink。

### Layer 4 - Messaging Service 层

Weixin Adapter 将 iLink 消息转换为 PicBind 的统一模型：

```json
{
  "id": "msg_xxx",
  "channel": "wechat",
  "senderId": "user_xxx",
  "conversationId": "chat_xxx",
  "type": "image",
  "payload": {
    "fileId": "file_xxx",
    "fileName": "photo.jpg",
    "mimeType": "image/jpeg"
  },
  "timestamp": 1785750000000
}
```

Messaging Core 负责：

- Provider 注册和生命周期。
- 标准消息分发。
- 发送、上传和下载的统一入口。
- 屏蔽 Room 对 iLink 数据结构的感知。

### Layer 5 - PicBind 业务层

业务层负责：

```text
NormalizedMessage
   |
Identity Resolver
   |
Room Resolver
   |
Image Workflow
   |
WASM Image Engine
   |
Storage
```

Messaging Service 不实现压缩、裁剪、格式转换或 Room 状态逻辑。

### Layer 6 - 回复层

图片工作流完成后：

```text
Result Event
   |
Messaging Service
   |
Weixin Adapter
   |
iLink Bot API
   |
微信用户
```

## 5. iLink 媒体处理

iLink 媒体通过微信 CDN 传输，不是普通公开图片 URL。

入站流程：

1. 从消息中读取 CDN 引用和文件密钥。
2. 校验下载地址，防止 SSRF。
3. 下载加密媒体。
4. 使用 AES-128-ECB 解密。
5. 将文件交给 PicBind Storage 或图片工作流。

出站流程：

1. 生成随机 16 字节 AES 密钥。
2. 使用 AES-128-ECB 和 PKCS#7 填充加密文件。
3. 通过 iLink `getuploadurl` 获取上传地址。
4. 上传密文。
5. 发送包含加密媒体引用的消息。

媒体密钥、原始 token 和加密中间数据不得返回给 Room 浏览器。

## 6. 会话与可靠性

Gateway 必须实现：

- 以消息 ID 为键的短期去重，建议窗口为 5 分钟。
- 每个账号和会话方的 `context_token` 持久化。
- `get_updates_buf` 或等价同步游标持久化。
- 长轮询超时后立即开始下一轮。
- 瞬时错误短暂重试，持续错误退避。
- `errcode=-14` 等会话过期状态进入待重新登录状态。
- 单 token 进程锁，防止多个 Gateway 同时轮询同一账号。
- 进程退出时停止轮询并释放锁。

## 7. 身份与 Room 绑定

外部身份保持渠道无关：

```text
message_identity
  id
  provider
  external_user_id
  external_chat_id
  created_at
```

Room 绑定：

```text
room_channel_binding
  id
  room_id
  user_id
  channel
  created_at
```

不要将字段命名为 `wechat_openid`。iLink 身份不是公众号 OpenID。

## 8. Room 与 Gateway 的边界

Room 只能调用 PicBind Messaging Gateway，不能直接调用腾讯 iLink API。

Room 侧需要的 Gateway 能力：

- 查询 Provider 配置和连接状态。
- 发起扫码登录。
- 获取二维码 URL、过期时间和扫码状态。
- 连接或断开已配置账号。
- 发送标准消息。
- 上传和下载业务文件。

当前扫码状态包含：

```text
qr_pending
scanned
confirmed
expired
error
```

当前 HTTP API：

```text
GET  /health
GET  /v1/providers/weixin
POST /v1/providers/weixin/login
GET  /v1/providers/weixin/login/:sessionId
POST /v1/providers/weixin/connect
POST /v1/providers/weixin/disconnect
GET  /v1/providers/weixin/events
POST /v1/providers/weixin/messages
```

二维码由 Gateway 使用 iLink 返回的 `qrcode_img_content` 生成。`qrcode` 字段只用于
查询状态，不能作为微信扫码内容。

## 9. 部署方式

Messaging Gateway 作为独立常驻进程部署在 VPS、NAS 或云服务器，由操作系统服务管理：

```text
systemd
   |
PicBind Messaging Gateway
   |
Tencent iLink Bot API
```

如果 Gateway 使用 Node.js，也可以在开发期使用 PM2；生产环境优先使用 `systemd`。

构建并启动：

```bash
cd messaging-service
pnpm build
pnpm dev:gateway
```

服务端环境变量：

```env
PICBIND_MESSAGING_HOST=127.0.0.1
PICBIND_MESSAGING_PORT=4390
PICBIND_MESSAGING_DATA_DIR=~/.picbind/messaging
PICBIND_MESSAGING_CORS_ORIGIN=http://localhost:3000
```

`account_id` 和 token 由扫码登录生成，默认写入
`~/.picbind/messaging/weixin-account.json`，文件权限为 `0600`。不能把这些值配置在
Web 项目中。Web 只配置公开 Gateway 地址：

```env
NEXT_PUBLIC_MESSAGING_GATEWAY_URL=http://127.0.0.1:4390
```

## 10. 代码接口

统一 Provider：

```ts
interface MessageProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: NormalizedMessage): Promise<void>;
  upload(file: Blob): Promise<string>;
  download(fileId: string): Promise<Blob>;
  subscribe(handler: MessageHandler): Unsubscribe;
}
```

当前 Room 使用的 iLink Gateway 客户端契约：

```ts
type IlinkGatewayTransport = {
  getStatus(): Promise<IlinkGatewaySnapshot>;
  startLogin(): Promise<IlinkLoginSession>;
  getLoginStatus(sessionId: string): Promise<IlinkLoginSession>;
  connect(onMessage: MessageHandler): Promise<void>;
  disconnect(): Promise<void>;
  send(message: NormalizedMessage): Promise<void>;
  upload(file: Blob): Promise<string>;
  download(fileId: string): Promise<Blob>;
};
```

所有响应都不得把原始 iLink token 暴露给调用方。

## 11. 开发阶段

### Phase 1 - Messaging Core

- [x] Normalized Message Model
- [x] Provider Interface
- [x] Event Dispatcher
- [x] Mock Provider
- [x] Weixin iLink Provider 客户端骨架
- [x] Room 顶部入口和 Provider 状态弹窗

### Phase 2 - iLink Gateway

- [x] 常驻 Gateway 进程入口
- [x] 二维码登录和状态轮询
- [x] iLink 凭证安全持久化
- [x] `getupdates` 长轮询
- [x] 同步游标、上下文 token 和去重
- [x] 文本接收与回复
- [x] `systemd` 服务文件
- [x] 跨进程单 token 实例锁

### Phase 3 - 图片工作流

- [x] 微信图片 CDN 下载与 AES 解密
- [x] Gateway 临时媒体存储和浏览器 `fileId` 下载
- [x] Room 微信聊天与收到的图片列表
- [ ] 图片和文件上传加密
- [ ] 外部身份解析
- [ ] Room 绑定
- [ ] Image Workflow 调用
- [ ] 处理结果回传微信

## 12. 关键实现文件

- `messaging-service/src/core/message.ts`
- `messaging-service/src/core/provider.ts`
- `messaging-service/src/router/dispatcher.ts`
- `messaging-service/src/providers/weixin/provider.ts`
- `messaging-service/src/providers/weixin/http-transport.ts`
- `messaging-service/gateway/ilink-client.ts`
- `messaging-service/gateway/credential-store.ts`
- `messaging-service/gateway/weixin-runtime.ts`
- `messaging-service/gateway/weixin-media.ts`
- `messaging-service/gateway/media-store.ts`
- `messaging-service/gateway/server.ts`
- `messaging-service/src/providers/mock/provider.ts`
- `sdk/room/src/config.ts`
- `sdk/room/src/components/share/messaging-service-dialog.tsx`
- `sdk/room/src/components/share/share-room-page.tsx`

## 13. 验收标准

Phase 2 完成的最低标准：

- Room 可以向 Gateway 请求真实 iLink 登录二维码。
- 用户扫码并在手机确认后，状态更新为已连接。
- Gateway 重启后可以恢复账号和同步游标。
- 微信私信文本能进入 `NormalizedMessage` 分发链。
- PicBind 可以向同一会话回复文本。
- token 不出现在浏览器、公开环境变量或客户端日志中。
- 同一 token 不会被两个轮询实例同时使用。

Phase 3 完成后，再验收图片接收、Room 工作流和图片结果回传。
