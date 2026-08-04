# PicBind Messaging Service - iLink Worker 实现

> 本文描述仓库中已经实现的腾讯 iLink Bot 消息服务。当前生产运行时为
> Cloudflare Worker + Durable Object，不再依赖独立 Node 常驻 Gateway。

| 项目 | 内容 |
| --- | --- |
| 版本 | 2.1 |
| 状态 | 已实现 |
| Worker 入口 | `cloudflare-worker/src/index.ts` |
| Durable Object | `WeixinMessagingObject` |
| 浏览器 Transport | Hibernation WebSocket |
| 图片存储 | R2 临时对象 |

## 1. 当前架构

```text
微信用户
   |
腾讯 iLink Bot API
   |
WeixinMessagingObject
   |-- Durable Object Storage
   |-- Alarm getupdates
   |-- WebSocket Hibernation
   `-- R2 临时图片
             |
             v
      Room Messaging Service
```

浏览器不持有 iLink token、同步游标、上下文 token 或图片 AES Key。

每个浏览器生成独立的随机 `messaging client ID`。Worker 使用该 ID 选择
Durable Object，因此不同浏览器的微信凭证和消息状态不会共享。

## 2. 代码目录

```text
cloudflare-worker/src/messaging/
|-- ilink-client.ts
|-- weixin-media.ts
|-- weixin-messaging.ts
`-- weixin-messaging-object.ts

sdk/room/src/messaging/providers/weixin/
|-- provider.ts
`-- http-transport.ts
```

浏览器 Messaging Core 和 Provider 已内聚到 Room SDK。旧 Node Gateway 和独立
`messaging-service` 包已删除，`dev-local.sh` 只启动 Web 与 Worker。

## 3. HTTP 与 WebSocket 接口

公开前缀：

```text
/api/messaging/weixin
```

接口：

```text
GET  /status
POST /login
GET  /login/:sessionId
POST /connect
POST /disconnect
POST /messages
GET  /files/:fileId
GET  /socket             WebSocket Upgrade
```

所有请求都携带浏览器本地生成的 32 位随机 `clientId`。该值用于 Durable
Object 分区，不包含微信凭证。

## 4. 扫码登录

1. Browser 调用 `POST /login`。
2. Worker 调用 iLink `get_bot_qrcode`。
3. Worker 返回 `qrData`，Browser 使用 `qrcode` 生成 Data URL。
4. Browser 定时调用 `GET /login/:sessionId`。
5. 微信确认后，DO 保存以下数据：
   - `accountId`
   - `bot token`
   - `baseUrl`
   - `userId`
   - `syncBuffer`
   - `contextTokens`
6. DO 设置 Alarm 并开始拉取消息。

原始 token 永远不会通过 HTTP 或 WebSocket 返回给 Browser。

## 5. Alarm 轮询

DO 不运行常驻 `while` 循环。每次 Alarm 只执行一次 `getupdates`：

```text
alarm
  -> 清理过期 R2 图片
  -> getupdates
  -> 更新 syncBuffer/contextTokens
  -> 解析并去重消息
  -> WebSocket 推送
  -> 安排下一次 alarm
```

成功后快速安排下一次调用。失败时先使用 2 秒退避；连续失败后使用 30 秒退避。
检测到 iLink Session 失效后停止轮询，状态变为 `error`，等待重新扫码。

DO 单线程串行执行，因此不再需要本地文件锁或进程锁。

## 6. WebSocket Hibernation

DO 通过 `state.acceptWebSocket(server, ["weixin-client"])` 接入 Hibernation
WebSocket。Browser 不发送应用层 `PING/PONG`，也不使用 WebSocket 测量网络状态；
连接状态由原生 `open`、`close`、`error` 事件和断线重连维护。

Browser Transport 包含指数退避重连。DO 会推送消息和状态，并处理带 `requestId`
的图片发送 RPC：

```text
NormalizedMessage
GATEWAY_STATUS
PREPARE_IMAGE_UPLOAD -> REQUEST_RESULT
SEND_IMAGE           -> REQUEST_RESULT
```

`GATEWAY_STATUS` 区分浏览器 WebSocket 已连接和 iLink 长轮询已连接，避免仅凭
WebSocket open 错误显示微信在线。

## 7. 微信图片

iLink 图片消息提供 CDN 参数和 AES Key，不直接包含完整图片。

当前流程：

```text
iLink image_item
  -> Worker 构造微信 CDN URL
  -> 校验 HTTPS 和 CDN 域名白名单
  -> 最多下载 20 MB
  -> AES-128-ECB 解密
  -> 检测 JPEG/PNG/GIF/WebP/AVIF
  -> 写入 MESSAGING_MEDIA_R2
  -> 创建短期下载 URL
  -> WebSocket 推送 URL 和元数据
```

默认配置：

| 参数 | 默认值 |
| --- | ---: |
| 图片大小上限 | 20 MB |
| R2 对象 TTL | 900 秒 |
| 签名 URL TTL | 900 秒 |

签名 URL 过期但对象仍存在时，Browser 使用 `fileId` 调用 `/files/:fileId`
刷新链接。R2 直链因 CORS、签名或网络原因读取失败时，Browser 使用
`proxy=1` 强制获取 Worker 代理地址，由 Worker 从 R2 返回图片。Alarm 删除到期
对象；链接到期本身不会删除 R2 数据。

生产环境配置 R2 S3 签名凭证后返回直接 R2 URL。本地没有签名凭证时返回
Worker 受控下载 URL，由 Worker 从本地 R2 binding 读取，行为与生产一致。

### 7.1 发送图片到微信

浏览器不会通过 HTTP 或 WebSocket 把图片二进制发送给 Worker。发送流程为：

```text
Room 图片
  -> WebSocket PREPARE_IMAGE_UPLOAD
  -> Worker 创建当前 clientId 专属 objectKey 和预签名 PUT URL
  -> Browser 使用 PUT 将 Blob 直接上传 R2
  -> WebSocket SEND_IMAGE（只包含 objectKey、接收者和图片元数据）
  -> Worker 校验待上传记录、过期时间、大小、MIME 和真实文件签名
  -> Worker 从 R2 binding 读取图片
  -> AES-128-ECB + PKCS#7 加密
  -> iLink getuploadurl
  -> POST 密文到微信 CDN
  -> iLink sendmessage 发送 image_item
  -> 删除 R2 临时对象和待上传记录
```

`objectKey` 必须由当前 Durable Object 生成并存在于待上传记录中，Browser 不能让
Worker 读取任意 R2 key。未完成的上传默认 15 分钟过期，由 Alarm 删除。发送成功或
失败后都会清理临时对象。iLink 要求的 `aes_key` 使用
`base64(hex(aesKey))`，不是原始 AES 字节的 Base64。

## 8. R2 对象规范

对象路径：

```text
messaging/weixin/{accountIdHash}/{messageIdHash}/{randomId}
```

对象 metadata 包含：

- `Content-Type`
- `Content-Disposition`
- `expiresAt`

聊天图片和 Room 图片使用独立 binding：

```text
MESSAGING_MEDIA_R2
SHARE_IMAGES_R2
```

两个 binding 当前可以指向同一 bucket，但代码路径和生命周期互相隔离。

## 9. 状态与去重

DO 保存六类状态：

- 微信账户凭证
- 运行状态与最近轮询成功时间
- 登录 Session
- 五分钟消息去重记录
- R2 临时对象索引
- 待发送图片上传记录

Provider 状态：

```text
disconnected  未启用
connecting    已启用，等待首次成功轮询
connected     最近一次 getupdates 成功
error         iLink 请求或 Session 异常
```

## 10. 配置

Wrangler bindings：

```toml
[[durable_objects.bindings]]
name = "WEIXIN_MESSAGING"
class_name = "WeixinMessagingObject"

[[r2_buckets]]
binding = "MESSAGING_MEDIA_R2"
bucket_name = "picbind-bucket"
```

Migration：

```toml
[[migrations]]
tag = "v3"
new_sqlite_classes = ["WeixinMessagingObject"]
```

环境变量：

```env
MESSAGING_MEDIA_TTL_SECONDS=900
MESSAGING_MEDIA_URL_TTL_SECONDS=900
MESSAGING_MAX_MEDIA_SIZE_MB=20
MESSAGING_PUBLIC_URL=https://api.picbind.com
NEXT_PUBLIC_MESSAGING_GATEWAY_URL=https://api.picbind.com
```

R2 S3 签名使用现有 Worker secrets：

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

这些值不能放入 `NEXT_PUBLIC_*`。

## 11. 本地开发

在仓库根目录执行：

```bash
./dev-local.sh
```

启动：

```text
Web               http://localhost:3000
Deployed Worker   https://api.picbind.com
```

`dev-local.sh` 不启动本地 Worker。Messaging Service 统一使用远端 Worker，也不再
单独监听 `4390`。

## 12. 关键兼容规则

- Browser 只接收规范化消息，不接收 iLink token 或 AES Key。
- Browser 发送图片时只直传 R2，WebSocket 不承载图片二进制。
- 图片 Blob 不写入 Durable Object Storage。
- R2 到期清理由 Alarm 执行。
- WebSocket 不使用应用层心跳检测网络状态。
- 单个图片失败不能终止后续消息处理。
- iLink Session 失效后必须重新扫码，不进行无限快速重试。
- 不同 Messaging Client ID 不得共享凭证或同步游标。
