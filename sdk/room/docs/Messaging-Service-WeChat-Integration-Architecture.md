# PicBind Messaging Service - WeChat Integration Architecture

> PicBind 多消息渠道服务微信接入架构设计  
> 参考 Hermes Messaging Service 模型

版本：1.0  
状态：已由 iLink 专项设计取代

> 本文档保留为早期设计记录。微信接入的当前依据是
> `Messaging-Service-WeChat-iLink-Integration.md`。旧文档中的微信公众号 Webhook、
> App ID/Secret 方案不适用于腾讯 iLink Bot API。当前实现使用 Cloudflare Worker、
> Durable Object Alarm 和 Hibernation WebSocket。

---

# 1. 背景

PicBind 当前核心能力：

- 图片压缩
- 图片格式转换
- 图片编辑
- Room 图片协作空间
- 图片云存储


当前用户入口：

```
Browser

    |

PicBind Web

    |

Room

    |

Image Processing
```


未来 PicBind 不应该只依赖 Web，而应该支持多消息入口：

```
微信
Telegram
Discord
Mobile
Web

      |

Messaging Service

      |

PicBind Core

      |

Room / Image Engine / Storage
```


参考 Hermes：

```
Telegram
Discord
WhatsApp
WeChat

      |

Messaging Layer

      |

AI Agent Core
```


PicBind 的目标：

> 将微信、Telegram、Discord 等消息渠道统一接入 PicBind，让用户通过聊天方式操作图片处理能力。


---

# 2. 目标

## 第一阶段目标

实现：

```
Wechat Messaging Provider
```


支持：

## 消息接收

用户可以发送：

- 文本
- 图片
- 文件


PicBind 可以接收。


## 消息发送

PicBind 可以回复：

- 文本
- 图片
- 文件
- 处理结果


最终效果：

```
用户微信

发送图片

    ↓

PicBind Messaging Service

    ↓

Room

    ↓

图片处理

    ↓

返回微信结果
```


---

# 3. 六层架构设计


PicBind 微信 Messaging Service 分为六层：

```
Layer 1
微信用户层

Layer 2
Bot 身份层

Layer 3
消息连接层

Layer 4
Messaging Service 层

Layer 5
PicBind 业务层

Layer 6
消息回复层
```


整体结构：

```
┌─────────────────────┐
│ Layer 1              │
│ 微信用户 User Layer  │
└──────────┬──────────┘
           |
           ↓

┌─────────────────────┐
│ Layer 2              │
│ Bot Identity Layer   │
└──────────┬──────────┘
           |
           ↓

┌─────────────────────┐
│ Layer 3              │
│ Transport Layer      │
│ WebSocket/Webhook    │
└──────────┬──────────┘
           |
           ↓

┌─────────────────────┐
│ Layer 4              │
│ Messaging Service    │
│ Adapter + Router     │
└──────────┬──────────┘
           |
           ↓

┌─────────────────────┐
│ Layer 5              │
│ PicBind Core         │
│ Room + Image Engine  │
└──────────┬──────────┘
           |
           ↓

┌─────────────────────┐
│ Layer 6              │
│ Response Layer       │
│ Send Message         │
└─────────────────────┘

```


---

# 4. Layer 1 - 微信用户层


## 职责

负责最终用户交互。


用户：

```
微信客户端

      |

PicBind AI Bot
```


用户操作：

- 添加 Bot
- 发送消息
- 接收回复


示例：

```
用户：

帮我压缩这张图片

发送:

photo.jpg
```


---

# 5. Layer 2 - Bot 身份层


## 职责

代表 PicBind 在微信中的身份。


类似：

Telegram Bot：

```
Bot Token
```


Discord Bot：

```
Bot Token
```


微信侧可能包含：

```
Bot ID

App ID

Secret

Token

Channel ID
```


作用：

验证：

```
PicBind

是否有权限连接微信消息服务
```


注意：

这一层不是用户身份。

不是：

```
OpenID
```


而是：

```
Bot Identity
```


---

# 6. Layer 3 - 消息连接层


## 职责

负责：

- 建立连接
- 保持通信
- 重连
- 心跳


可能方式：

---

## WebSocket


结构：

```
PicBind

    |

 WebSocket

    |

微信 Message Gateway
```


支持：

- 实时消息
- 长连接


---

## Webhook


结构：

```
微信服务器

      |

      |

HTTP POST

      |

      |

PicBind
```


例如：

```
POST

/api/wechat/messages
```


收到：

```json
{
    "type":"image",
    "user":"xxx"
}
```


---

# 7. Layer 4 - Messaging Service 层


这是 PicBind 核心抽象层。


目标：

> 不让业务层感知微信、Telegram、Discord 的区别。


微信消息：

```
Wechat Event

{
 image,
 user,
 timestamp
}
```


转换：

```
Normalized Message
```


统一模型：

```json
{
    "id":"msg_xxx",

    "channel":"wechat",

    "sender_id":"user_xxx",

    "conversation_id":"chat_xxx",

    "type":"image",

    "payload":{
        "file_id":"xxx"
    }
}
```


---

# 8. Provider 设计


目录：

```
sdk/room/src/messaging/


├── core

│   ├── message.go

│   ├── event.go

│   └── provider.go


├── providers

│
│── wechat

│   ├── client.go

│   ├── receiver.go

│   ├── sender.go

│   └── parser.go
│
│── telegram
│
│── discord


└── router

    └── dispatcher.go
```


---

# 9. Provider 接口


所有消息渠道统一：

```go
type MessageProvider interface {


    Start() error


    Receive(
        handler MessageHandler
    )


    Send(
        message Message
    ) error


    Upload(
        file File
    ) error


    Download(
        id string
    ) ([]byte,error)

}
```


未来：

```
WechatProvider

TelegramProvider

DiscordProvider
```


实现相同接口。


---

# 10. 用户身份设计


Messaging Service 需要保存：

外部渠道用户。


不要设计：

```
wechat_openid
```


应该设计：

```
external identity
```


数据库：

## message_identity


```sql
id

provider

external_user_id

external_chat_id

created_at
```


例如：

微信：

```
provider:

wechat


external_user_id:

xxxxx
```


Telegram：

```
provider:

telegram


external_user_id:

123456
```


---

# 11. Layer 5 - PicBind 业务层


Messaging Service 不处理图片业务。


它只负责：

```
消息进入

↓

找到业务
```


业务流程：

```
微信图片

    |

Messaging Service

    |

User Resolver

    |

Room Resolver

    |

Image Workflow

    |

Compression Engine

    |

Storage
```


---

# 12. Room 与消息绑定


关系：

```
微信用户

      |

PicBind User

      |

Room
```


数据库：


## room_channel_binding


```sql
id

room_id

user_id

channel

created_at
```


例如：

```
Room:

room_001


绑定:

wechat_user_xxx
```


---

# 13. Layer 6 - 消息回复层


处理完成：

```
Image Engine

    |

Result Event

    |

Messaging Service

    |

Wechat Provider

    |

微信用户
```


回复：

```
图片处理完成

原图:

20MB


压缩:

2MB


节省:

90%

下载:

https://picbind.com/r/xxx
```


---

# 14. 第一阶段开发计划


## Phase 1

实现 Messaging Core


完成：

- Message Model
- Provider Interface
- Event Dispatcher


使用：

Mock Provider


流程：

```
Mock Message

↓

Messaging Service

↓

Room

↓

Reply
```


---

## Phase 2

接入微信连接层


目标：

```
微信

<---->

PicBind
```


完成：

- 收文字消息
- 回复文字消息


---

## Phase 3

图片消息


实现：

```
微信图片

↓

PicBind

↓

Room

↓

Image Engine

↓

返回结果
```


---

# 15. 推荐技术架构


PicBind：

```
picbind/


├── web

│
├── cloudflare-worker

│
├── sdk/room/src/messaging

│
├── room-service

│
├── image-engine

│
└── storage
```


其中：


## Worker

负责：

- Webhook入口
- 请求验证
- 快速响应


## Messaging Service

负责：

- 消息生命周期
- Provider管理
- 用户映射
- 消息路由


## Room Service

负责：

- Room状态
- 工作流


## Image Engine

负责：

- Rust图片处理


---

# 16. 最终目标


PicBind 从：

```
图片压缩网站
```


升级为：

```
PicBind Image Assistant


入口：

Web

微信

Telegram

Discord

Mobile


        |

Messaging Service


        |

PicBind Core


        |

Image Intelligence

```


---

# 17. 第一阶段验收标准


完成：

- [x] 独立 Messaging Core
- [x] Message Model
- [x] Provider Interface
- [x] Event Dispatcher
- [x] Mock Provider
- [x] 可注入 Transport 的 Wechat Provider
- [ ] 创建微信 Bot 接入
- [ ] Worker Webhook 与请求验证
- [ ] PicBind 连接微信消息服务
- [ ] 接收微信消息
- [ ] 回复微信消息
- [ ] 接收图片
- [ ] 触发 Room
- [ ] 返回处理结果


完成后：

进入：

第二阶段：

多渠道 Messaging Service 扩展。
