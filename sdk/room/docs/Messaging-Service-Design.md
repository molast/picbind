# PicBind Messaging Service Design

> PicBind 多消息渠道服务设计文档，参考 Hermes Messaging Service 架构。

| 项目 | 内容 |
| --- | --- |
| 版本 | 1.0 |
| 状态 | 设计阶段 |

> 微信 Provider 的具体实现以 `Messaging-Service-WeChat-iLink-Integration.md` 为准。
> 当前采用腾讯 iLink Bot API、扫码登录、Cloudflare Durable Object Alarm
> 长轮询和 Hibernation WebSocket，不使用微信公众号 Webhook。iLink token 仅由
> `WeixinMessagingObject` 持有，不进入浏览器。

## 当前实现范围

当前仓库已经实现：

- 统一消息模型与 Provider 接口
- `MessageEventDispatcher`
- `MessagingService` Provider 注册、生命周期、收发与状态订阅
- `WeixinIlinkProvider` 与可注入的 `IlinkGatewayTransport`
- Room 顶部消息服务入口、Provider 状态和连接控制

当前还实现了：

- iLink 扫码登录和 Durable Object 凭证持久化
- Alarm 驱动的 `getupdates` 长轮询
- Hibernation WebSocket 消息和状态推送
- 微信图片下载、AES 解密、R2 临时存储和短期链接
- 按浏览器 Messaging Client ID 隔离微信 Bot 状态

`WeixinIlinkProvider` 通过 `IlinkGatewayTransport` 对接 Worker。iLink token 不得
放入浏览器或 Room SDK。

## 1. 背景

PicBind 当前定位：

- 图片压缩
- 图片格式转换
- 图片编辑
- Room 图片协作空间
- 图片云存储

当前用户入口：

```text
Browser
  |
PicBind Web
  |
Room
  |
Image Processing
```

但是未来 PicBind 不应该只依赖 Web。

参考 Hermes 的 Messaging Service 设计：

```text
Telegram    Discord    WhatsApp    WeChat
    \          |          |          /
             Messaging Service
                     |
              Core Application
```

PicBind 需要设计自己的消息服务层：

```text
微信    Telegram    Discord    Web    Mobile
  \         |          |        |       /
              Messaging Service
                       |
                  PicBind Core
                       |
          +------------+------------+
          |            |            |
        Room      Image Engine    Storage
```

目标：

> 让 PicBind 可以通过不同消息平台作为入口，统一进入 Room 和图片处理流程。

---

## 2. 第一阶段目标

第一阶段只实现 `Wechat Provider`。

目标是实现 PicBind 与微信双向通信。

### 2.1 接收消息

微信用户可以发送：

- 文本
- 图片
- 文件

PicBind 可以接收这些消息。

### 2.2 发送消息

PicBind 可以回复：

- 文本
- 图片
- 文件
- 处理结果

最终流程：

```text
用户微信
   |
发送图片
   |
PicBind Messaging Service
   |
Room
   |
图片处理
   |
返回微信结果
```

---

## 3. 核心设计理念

Messaging Service 不负责业务，只负责：

- 连接外部消息平台
- 接收消息
- 转换消息格式
- 发送消息

业务由以下模块负责：

- Room Service
- Image Workflow
- Storage Service

架构：

```text
External Channel
       |
Messaging Provider
       |
Normalized Message
       |
 Event Dispatcher
       |
 Business Service
```

---

## 4. 整体架构

```text
微信
  |
Wechat Provider
  |
PicBind Messaging Service
  |
Message Event
  |
Room Service
  |
Image Processing Engine
  |
R2
```

---

## 5. Messaging Service 模块设计

当前 TypeScript 实现的目录结构：

```text
sdk/room/src/messaging/
├── core/
│   ├── message.ts
│   ├── event.ts
│   └── provider.ts
├── providers/
│   ├── mock/
│   │   └── provider.ts
│   ├── weixin/
│   │   ├── provider.ts
│   │   └── http-transport.ts
│   └── wechat/              # 旧名称兼容导出
│       └── provider.ts
├── router/
│   └── dispatcher.ts
└── index.ts
```

---

## 6. 统一消息模型

所有平台消息必须转换成统一格式。

### 6.1 Message 示例

```json
{
  "id": "msg_xxxxx",
  "channel": "wechat",
  "sender": {
    "id": "user_xxxxx"
  },
  "type": "image",
  "content": {
    "text": "",
    "file_id": ""
  },
  "timestamp": 123456789
}
```

### 6.2 字段说明

| 字段 | 说明 |
| --- | --- |
| `channel` | 消息来源 |
| `sender.id` | 用户身份 |
| `type` | 消息类型 |
| `content` | 消息内容 |

---

## 7. Provider 接口设计

每个消息平台实现一个 Provider，例如：

- `WeixinIlinkProvider`
- `TelegramProvider`
- `DiscordProvider`

统一接口：

```go
type MessageProvider interface {
    Start() error

    Receive(handler MessageHandler)

    Send(message Message) error

    Upload(file File) error

    Download(fileID string) ([]byte, error)
}
```

---

## 8. 微信 Provider 设计

微信渠道实现为 `WeixinIlinkProvider`，通过 `WeixinMessagingObject` 接入腾讯
iLink Bot API。

### 8.1 建立微信连接

iLink 使用 HTTP 长轮询。二维码登录、`getupdates` 轮询、同步游标和 token
持久化由 Durable Object 处理，不使用公众号 Webhook，也不由浏览器直接连接
iLink。浏览器 WebSocket 只连接 PicBind Worker。

### 8.2 接收消息

```text
微信用户
   |
微信消息服务
   |
WeixinIlinkProvider
   |
Message Parser
   |
统一 Message
   |
Messaging Service
```

### 8.3 发送消息

```text
PicBind
   |
Messaging Service
   |
WeixinIlinkProvider
   |
微信接口
   |
用户微信
```

---

## 9. 用户身份绑定设计

Messaging Service 需要保存外部平台用户。

例如，微信用户标识为 `wechat_user_id`。

数据库表：

```sql
channel_users
  id
  channel
  external_user_id
  created_at
```

示例：

```text
channel: wechat
external_user_id: xxxxxxxx
```

> 注意：这里保存的是微信平台提供的用户标识，不是微信号。

---

## 10. Room 与 Messaging Service 的关系

```text
微信
  |
Messaging Service
  |
PicBind User
  |
Room
```

数据库表：

```sql
room_channels
  id
  room_id
  user_id
  channel
  created_at
```

示例：

```text
Room: room_001
绑定: wechat_user_xxxx
```

后续微信发送图片的处理流程：

```text
图片
  |
找到用户
  |
找到 Room
  |
执行工作流
```

---

## 11. 消息处理流程

以用户发送图片为例：

```text
微信
  |
Wechat Provider
  |
Message Event
  |
Room Resolver
  |
Image Workflow
  |
Image Processor
  |
Storage
  |
Wechat Reply
```

---

## 12. 第一阶段开发计划

### Phase 1：研究微信接入能力

确认：

- 微信 Bot 能力
- API
- Token
- 消息接收方式
- 消息发送方式
- 文件处理方式

输出：

- Wechat Provider 技术方案

### Phase 2：实现 Messaging Service Core

完成：

- Message Model
- Provider Interface
- Event Dispatcher

先使用 Mock Provider 进行测试：

```text
Mock Message
     |
Messaging Service
     |
Room
```

### Phase 3：实现微信 Provider

支持接收：

- 文本
- 图片

支持发送：

- 文本

完成双向通信：

```text
微信 <----> PicBind
```

### Phase 4：接入 Room

实现流程：

```text
微信发送图片
     |
PicBind 收到图片
     |
进入 Room
     |
压缩
     |
上传 R2
     |
返回结果
```

---

## 13. 后续扩展

未来增加：

```text
providers/
├── weixin/
├── telegram/
├── discord/
├── slack/
└── mobile/
```

所有入口统一使用：

- Message
- Event
- Room
- Workflow

---

## 14. 最终目标

PicBind 从“图片处理网站”升级为 `PicBind Image Assistant`。

```text
Web    微信    Telegram    Discord    Mobile
 \      |         |          |         /
             Messaging Service
                      |
                 PicBind Core
                      |
             Image Intelligence
```

---

## 15. 第一阶段验收标准

- [ ] 微信消息接入
- [ ] PicBind 接收微信消息
- [ ] PicBind 回复微信消息
- [ ] 接收图片
- [ ] 触发 Room 工作流
- [ ] 返回处理结果

完成后进入第二阶段：多消息渠道扩展。
