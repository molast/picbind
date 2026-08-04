# PicBind Messaging Service - 微信 iLink 接入架构

> 本文档描述 PicBind 当前通过腾讯 iLink Bot API 接入个人微信 Bot 的实际实现。
> 详细接口与部署参数见 `Messaging-Service-iLink-Gateway-Implementation.md`。

| 项目 | 内容 |
| --- | --- |
| 版本 | 2.0 |
| 状态 | 文本与微信图片入站链路已实现，媒体出站待实现 |
| 接入类型 | 腾讯 iLink Bot API |
| 运行方式 | Cloudflare Worker + Durable Object + R2 |
| 浏览器通道 | Hibernation WebSocket |

## 1. 当前实现范围

当前仓库已经实现：

- Room SDK 中的统一消息模型、Provider、事件分发和浏览器 Transport。
- `WeixinIlinkProvider` 和 `IlinkGatewayTransport` 客户端接口。
- Worker 中的 iLink 扫码登录和扫码状态轮询。
- 每个浏览器 Messaging Client ID 对应独立 Durable Object。
- iLink 凭证、同步游标和会话 `context_token` 的 DO 持久化。
- Durable Object Alarm 驱动的 `getupdates` 长轮询和退避重试。
- Hibernation WebSocket 推送连接状态和规范化消息。
- 微信图片 CDN 下载、AES-128-ECB 解密、格式验证和 R2 临时存储。
- 带过期时间的图片下载链接和基于 `fileId` 的链接刷新。
- Room 独立微信聊天弹窗、收到的图片列表和移入工作区操作。

当前尚未实现：

- 微信图片、视频、语音和普通文件出站。
- 微信身份与 PicBind 用户或 Room 的长期绑定。

## 2. 接入边界

本方案使用：

- 腾讯 iLink Bot API。
- iLink Bot 身份，例如 `...@im.bot`。
- 微信扫码登录。
- Alarm 触发的 HTTP `getupdates` 长轮询。
- Browser 到 PicBind Worker 的 WebSocket。

本方案不使用：

- 微信公众号或公众号 Webhook。
- 企业微信、自建应用、Wechaty、Gewechat、WCFerry 或 itchat。
- 浏览器直接访问 iLink API。
- 浏览器或公开环境变量保存 iLink token。
- WebSocket 应用层心跳或网络状态探测。

iLink Bot 身份与扫码所用的个人微信账号是两个独立身份。群聊事件是否可用由
iLink 账号能力决定，不能由 PicBind 的 Room 逻辑保证。

## 3. 当前架构

```text
微信用户
   |
腾讯 iLink Bot API
   |
Cloudflare Worker
   |
WeixinMessagingObject (Durable Object)
   |-- Alarm: getupdates
   |-- Storage: token / sync buffer / context token
   |-- Hibernation WebSocket
   |-- R2: 临时图片
   |
Messaging Core
   |
Room / Image Workflow
```

对应仓库目录：

```text
pix-wasm/
├── cloudflare-worker/src/messaging/  # iLink 服务端实现
├── sdk/room/src/messaging/            # Browser Core、Provider 与 Transport
├── sdk/room/                          # Room UI 和消息消费方
└── web/                               # Room SDK 宿主与公开 Worker 地址配置
```

旧 Node Gateway 和独立 `messaging-service` 包已经删除。服务端 iLink 逻辑只存在于
Cloudflare Worker，浏览器客户端逻辑由 Room SDK 自己维护。

## 4. 身份与隔离

Browser 首次使用时生成随机 32 位十六进制 Messaging Client ID，并存入浏览器本地
存储。所有 Messaging HTTP 和 WebSocket 请求都携带该 ID。

Worker 使用 Client ID 选择 Durable Object：

```text
Client ID A -> WeixinMessagingObject A -> 微信账号 A
Client ID B -> WeixinMessagingObject B -> 微信账号 B
```

因此不同浏览器不会共享扫码凭证、同步游标或会话上下文。原始 token 永远不会通过
HTTP 或 WebSocket 返回给 Browser。

## 5. 长轮询生命周期

DO 不运行常驻循环。一次 Alarm 只执行一次 `getupdates`：

```text
Alarm 唤醒 DO
  -> 调用一次 getupdates
  -> 保存 sync buffer / context token
  -> 推送规范化消息
  -> 安排下一次 Alarm
  -> DO 可再次休眠
```

成功后立即调度下一次；短暂失败按 2 秒退避，多次失败按 30 秒退避。会话过期后停止
轮询，等待重新扫码。该方式允许 iLink 长轮询运行在 Cloudflare Durable Object 上，
不需要独立 Node 常驻进程。

## 6. Browser WebSocket

WebSocket 只承担：

- 推送 `GATEWAY_STATUS`。
- 推送标准化微信消息。

WebSocket 使用 Durable Object Hibernation。Browser 不发送 `PING/PONG`，不通过
WebSocket 计算延迟或判断网络质量。断线由原生 `close`/`error` 事件触发指数退避重连。

Room 的弱网中继 WebSocket 采用同一原则：不发送 WebSocket 心跳。Room 原有的
WebRTC DataChannel 探测用于决定是否切换中继，HTTP presence 心跳用于维持房间成员
状态，两者不是 WebSocket 心跳，继续保留。Presence 每 60 秒刷新一次，服务端连续
120 秒没有收到成员活动后将其置为离线。

## 7. 图片入站

iLink 图片并不是浏览器可直接使用的公开 URL。当前流程：

1. DO 从消息中读取 CDN 引用和 AES 密钥。
2. Worker 校验 CDN 主机白名单、大小上限和请求超时。
3. Worker 下载密文并使用 AES-128-ECB 解密。
4. Worker 检查 JPEG、PNG、GIF、WebP 或 AVIF 文件魔数。
5. 明文图片写入 `MESSAGING_MEDIA_R2`。
6. WebSocket 仅推送文件元数据、`fileId` 和短期下载 URL。
7. Browser 下载失败或 URL 过期时，通过 `fileId` 刷新 URL 后重试。
8. Alarm 清理到期 R2 对象。

Blob 数据不写入 Durable Object Storage。DO 只保存账号、游标、会话和 R2 对象关联
信息。

## 8. 消息模型

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
    "mimeType": "image/jpeg",
    "downloadUrl": "https://..."
  },
  "timestamp": 1785750000000
}
```

Messaging Core 负责 Provider 生命周期、标准消息分发和统一收发接口。图片压缩、裁剪、
格式转换和 Room 状态仍由业务层负责。

## 9. 本地与生产部署

本地只需执行：

```bash
./dev-local.sh
```

脚本只启动本地 Web。Messaging 和其他 Worker 接口统一请求已部署的
`https://api.picbind.com`，不启动 `8787` 或 `4390` 服务。

开发环境：

```env
NEXT_PUBLIC_MESSAGING_GATEWAY_URL=https://api.picbind.com
```

生产环境：

```env
NEXT_PUBLIC_MESSAGING_GATEWAY_URL=https://api.picbind.com
```

生产部署必须包含 Wrangler 中的 `WEIXIN_MESSAGING` Durable Object migration 和
`MESSAGING_MEDIA_R2` 绑定。首次使用 Worker 版本时需要扫码建立账号。

## 10. 关键实现文件

- `cloudflare-worker/src/messaging/ilink-client.ts`
- `cloudflare-worker/src/messaging/weixin-media.ts`
- `cloudflare-worker/src/messaging/weixin-messaging.ts`
- `cloudflare-worker/src/messaging/weixin-messaging-object.ts`
- `cloudflare-worker/src/index.ts`
- `cloudflare-worker/wrangler.toml`
- `sdk/room/src/messaging/providers/weixin/http-transport.ts`
- `sdk/room/src/messaging/providers/weixin/provider.ts`
- `sdk/room/src/components/share/share-room-page.tsx`
- `sdk/room/src/utils/weak-network-socket.ts`

## 11. 验收边界

当前已通过静态检查和基础本地链路验证：

- Worker 状态接口可访问。
- Messaging WebSocket 可连接并收到 `GATEWAY_STATUS`。
- Room 与 Messaging 浏览器代码通过 TypeScript 检查。

真实 iLink 扫码、真实微信图片下载解密和生产 R2 链路仍需使用有效微信账号及生产绑定
做端到端验证。
