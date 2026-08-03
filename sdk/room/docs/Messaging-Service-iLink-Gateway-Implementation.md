# PicBind Messaging Service - iLink Gateway Implementation

> PicBind 微信 iLink Gateway 实现设计  
> 负责 iLink 扫码登录、凭证管理、消息长轮询、事件转发

版本：1.0  
状态：开发设计


---

# 1. 背景

PicBind Messaging Service 需要接入微信 iLink Bot。


iLink Gateway 的职责：

- 创建扫码登录流程
- 获取二维码
- 等待微信扫码确认
- 保存 Bot 登录凭证
- 自动恢复 Session
- 长轮询获取消息
- 转换消息事件
- 推送到 Messaging Core


整体：

```
微信 iLink

      |

      |

iLink Gateway

      |

      |

Messaging Core

      |

      |

Room / Image Workflow

```


---

# 2. Gateway 在整体架构中的位置


```
                  微信用户


                     |

                     |


              微信 iLink 平台


                     |

                     |


          +--------------------+

          |  iLink Gateway     |

          +--------------------+

             |          |

             |          |

        Session      Polling


             |

             |

    +---------------------+

    | Messaging Core      |

    +---------------------+

             |

             |

          PicBind Core

```


---

# 3. 服务目录设计


```
messaging-service/


├── cmd

│   └── gateway

│       └── main.go


├── gateway


│   └── wechat


│       ├── client.go

│       ├── login.go

│       ├── qrcode.go

│       ├── session.go

│       ├── polling.go

│       ├── sender.go

│       └── parser.go


├── core


│   ├── message.go

│   ├── event.go

│   └── dispatcher.go


├── storage


│   └── credential_store.go


└── config

    └── config.go

```


---

# 4. Gateway 生命周期


启动：

```
Service Start

      |

检查 Session

      |

是否存在有效凭证？

      |

 +----+----+

 |         |

有         无

 |         |

恢复      创建二维码

 |         |

启动      等待扫码

Polling   |

          保存凭证

              |

          启动 Polling

```


---

# 5. 登录流程设计


## 5.1 创建二维码


流程：

```
PicBind

      |

请求二维码

      |

iLink API

      |

返回二维码数据

      |

展示给管理员

```


返回：

```json
{
    "qr_code":"xxx",

    "expire":300
}
```


保存：

```
login_session_id
```


---

# 5.2 用户扫码


管理员：

```
手机微信

      |

扫描二维码

      |

确认登录

```


状态变化：

```
WAIT_SCAN

      ↓

SCANNED

      ↓

CONFIRMED

```


---

# 5.3 获取凭证


扫码成功：

iLink 返回：

```json
{
    "account_id":"xxx",

    "token":"xxx",

    "base_url":"xxx"
}
```


保存。


---

# 6. Credential 存储设计


不要把 Token 写死配置文件。


使用数据库。


## wechat_bot_credentials


```sql
CREATE TABLE wechat_bot_credentials
(

id bigint primary key,


account_id varchar(128),


token text,


base_url varchar(255),


status varchar(32),


created_at timestamp,


updated_at timestamp

);

```


---

数据：

```json
{
    "account_id":"bot_xxx",

    "token":"xxxx",

    "base_url":"https://xxx",

    "status":"active"
}

```


---

# 7. Session 管理


内存：

```
WechatSession
```


结构：

```go
type Session struct {


    AccountID string


    Token string


    BaseURL string


    LastMessageID string


    Status string


}

```


状态：

```
CREATED

LOGIN_PENDING

ACTIVE

EXPIRED

DISCONNECTED

```


---

# 8. Polling 设计


iLink Gateway 启动：

```
Start()

   |

Load Session

   |

Start Polling Loop

```


核心：

```go
func StartPolling(){


    for {


        messages := client.GetUpdates()


        handle(messages)


        sleep()

    }

}

```


---

# 9. 长轮询流程


```
Polling Worker


       |

       |

请求消息


       |

       |

iLink API


       |

       |

等待消息


       |

       |

返回 Event


       |

       |

Message Parser


       |

       |

Messaging Core

```


---

# 10. Polling 注意事项


## 心跳


定期：

```
heartbeat
```


防止：

- Session 失效
- 网络断开


---

## 重连


异常：

```
Connection Lost
```


处理：

```
wait

retry

restore session

restart polling

```


---

## 消息去重


因为网络异常可能重复获取。


保存：

```
last_message_id
```


数据库：

```sql
wechat_message_cursor


account_id


last_message_id


updated_at

```


---

# 11. Message Parser


iLink 原始消息：

```json
{
    "msg_id":"xxx",

    "sender":"xxx",

    "type":"image",

    "content":{}
}

```


转换：

PicBind Message:


```json
{
    "id":"xxx",

    "channel":"wechat",

    "sender_id":"xxx",

    "conversation_id":"xxx",

    "type":"image",

    "payload":{}

}

```


---

# 12. Sender 设计


发送：

```
PicBind

    |

Messaging Core

    |

Wechat Gateway

    |

iLink API

    |

微信用户

```


接口：

```go
func SendMessage(
    msg Message
) error

```


支持：

- text
- image
- file


---

# 13. Gateway 与 Messaging Core 通信


不要直接调用 Room。


错误：

```
Gateway

 |

Room

```


正确：

```
Gateway

 |

Event Dispatcher

 |

Messaging Core

 |

Room

```


事件：

```json
{
"type":"message.received",

"channel":"wechat",

"data":{}

}

```


---

# 14. 多 Bot 支持设计


未来：

```
PicBind AI

        |

wechat bot 1


PicBind Enterprise

        |

wechat bot 2

```


数据库：

```
wechat_bot_credentials

      |

      |

account_id

```


每个 Bot：

独立：

- Session
- Polling
- Message Cursor


---

# 15. 配置


环境变量：

```
DATABASE_URL=

LOG_LEVEL=info


WECHAT_ENABLE=true

```


---

# 17. 第一阶段实现范围


必须完成：

## Login

- [ ] 请求二维码
- [ ] 展示二维码
- [ ] 扫码确认
- [ ] 保存 Token


## Session

- [ ] 加载凭证
- [ ] 自动恢复


## Polling

- [ ] 长轮询
- [ ] 消息获取
- [ ] 自动重连


## Messaging

- [ ] 转换 Message
- [ ] 发送事件


---

# 18. 第二阶段


增加：

- 图片消息
- 文件消息
- 图片上传
- Room 自动绑定
- 消息历史


---

# 19. 最终目标


完成后：

```
微信


  |

iLink Gateway


  |

Messaging Service


  |

PicBind Room


  |

Image Processing


  |

微信回复

```


PicBind 将拥有：

```
统一 Messaging Gateway

支持:

WeChat

Telegram

Discord

Slack

```
