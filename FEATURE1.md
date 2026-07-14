# PicBind Realtime V1 需求文档

## 1. 项目背景

PicBind 当前是一个基于 **Rust WASM + TypeScript** 的纯前端图片压缩应用：

* 图片处理全部在浏览器端完成
* Rust WASM 负责高性能图片压缩
* TypeScript 负责 UI 和业务逻辑
* 部署于 Cloudflare Pages
* 无传统后端服务
* 已接入 Cloudflare 服务用于统计

当前 PicBind 的核心能力是：

> 用户上传图片，在本地完成压缩，并下载优化后的结果。

为了增强用户之间的连接能力，引入 Cloudflare Realtime，实现浏览器之间的实时通信能力。

---

# 2. V1 目标

## 核心目标

实现：

> 用户之间可以通过 PicBind 创建临时分享会话，将浏览器中的图片实时分享给其他用户。

第一阶段重点不是社区、聊天或者协同计算，而是：

1. 打通 Cloudflare Realtime 通信链路
2. 建立用户之间的数据传输能力
3. 验证浏览器之间实时交互模式

---

# 3. 产品定位

PicBind Realtime V1 是：

> 一个基于浏览器实时连接的临时图片分享功能。

特点：

* 无需上传服务器
* 无需注册账号
* 图片不经过 PicBind 后端存储
* 数据直接通过实时通信链路传输
* 分享会话临时有效

---

# 4. 功能范围

## 4.1 创建分享房间

用户 A 打开 PicBind。

点击：

```
Share Images
```

系统创建一个临时分享房间。

生成：

```
Room ID
```

以及分享链接：

```
https://picbind.com/share/{roomId}
```

用户可以复制链接发送给其他人。

---

## 4.2 加入分享房间

用户 B 打开分享链接。

流程：

```
打开链接

↓

初始化 Realtime Client

↓

加入 Room

↓

建立实时连接

↓

等待图片分享
```

成功后：

双方进入同一个实时会话。

---

## 4.3 图片实时分享

V1 默认模式：

```
Owner
 |
 |
 v
Guest
```

只有创建房间的用户可以发送图片。

流程：

```
选择图片

↓

读取 File

↓

转换 ArrayBuffer

↓

分片

↓

Realtime DataChannel发送

↓

接收端重新组装

↓

显示图片
```

---

## 4.4 实时状态同步

Realtime 消息不用于聊天。

消息仅用于维护实时状态。

包括：

### 用户状态

例如：

```
User Joined

User Left

User Online
```

---

### 图片状态

例如：

```
Image Start

Image Transfering

Image Completed

Image Failed
```

---

### 连接状态

例如：

```
Connecting

Connected

Disconnected

Reconnecting
```

---

# 5. 非目标功能

V1 明确不实现：

## 不做账号系统

不包含：

* 用户注册
* 登录
* 用户资料

---

## 不做聊天室

不支持：

* 文本聊天
* Emoji
* 消息历史

Realtime Message 仅用于：

* 状态同步
* 图片传输协议

---

## 不做图片云端存储

禁止：

```
Browser

↓

Worker

↓

R2

↓

Browser
```

图片不会上传到 Cloudflare 存储。

---

## 不做协同压缩

暂不实现：

* 图片任务分配
* 多用户 WASM 压缩
* 压缩结果合并

该功能属于后续版本。

---

# 6. 技术架构

整体架构：

```
                    Browser

          Rust WASM + TypeScript


                       |

                       |

              Cloudflare Pages


                       |

                       |

              Cloudflare Worker


                       |

              -----------------

              |               |

              |               |

        Durable Object    Realtime SFU

        Room Manager      DataChannel


                              |

                              |

                       Browser Peers

```

---

# 7. Cloudflare 组件职责

## Cloudflare Pages

负责：

* 前端资源托管
* WASM 文件加载
* Web UI

---

## Cloudflare Worker

负责：

* API 入口
* 创建房间
* 获取房间信息
* 生成连接凭证
* 调用 Durable Object

例如：

```
POST /api/realtime/room/create
```

返回：

```json
{
  "roomId": "abc123",
  "token": "xxx"
}
```

---

## Durable Object

负责：

房间状态管理。

包括：

* Room 生命周期
* 用户加入
* 用户退出
* 在线状态
* 心跳检测

示例：

```json
{
  "roomId": "abc123",
  "users": [
    {
      "id": "user-a",
      "role": "owner"
    },
    {
      "id": "user-b",
      "role": "guest"
    }
  ]
}
```

---

## Cloudflare Realtime SFU

负责：

实时数据通信。

包括：

* DataChannel 建立
* 消息转发
* 浏览器之间实时通信

传输内容：

* JSON 状态消息
* 图片二进制数据

---

# 8. 数据协议设计

Realtime 消息统一格式：

```typescript
interface RealtimeMessage {

    type: string

    timestamp: number

    payload: unknown

}
```

---

## 用户事件

```typescript
{
    type:"USER_JOIN",
    payload:{
        userId:"xxx"
    }
}
```

---

## 图片开始

```typescript
{
    type:"IMAGE_START",
    payload:{
        id:"image-id",
        name:"cat.png",
        size:102400
    }
}
```

---

## 图片分片

```typescript
{
    type:"IMAGE_CHUNK",
    payload:{
        id:"image-id",
        index:1,
        data:ArrayBuffer
    }
}
```

---

## 图片完成

```typescript
{
    type:"IMAGE_COMPLETE",
    payload:{
        id:"image-id"
    }
}
```

---

# 9. 图片传输设计

## 分片传输

图片不能直接发送整个 Blob。

采用：

```
Image

↓

ArrayBuffer

↓

Chunk

↓

DataChannel

↓

Reassemble

↓

Blob
```

---

默认分片大小：

```
64KB
```

可根据网络情况动态调整。

---

# 10. 安全设计

## 数据安全原则

PicBind 不保存用户图片。

图片只存在：

* 发送用户浏览器
* 接收用户浏览器

---

## 传输安全

使用：

```
WebRTC DataChannel
```

提供：

```
DTLS 加密
```

保证传输链路安全。

---

## 房间安全

采用：

随机 Room ID。

例如：

```
12位随机字符串
```

避免：

```
room=1
room=2
```

等容易猜测的地址。

---

## 房间生命周期

临时房间：

默认：

```
30分钟自动过期
```

无人连接后自动销毁。

---

# 11. 数据存储策略

V1 不保存图片数据。

Durable Object 仅保存：

```
Room Metadata
Connection State
User Presence
```

SQLite 仅用于：

* 统计
* 调试
* 后续分析

---

# 12. 后续扩展方向

## V2 协同压缩

基于 V1：

增加：

```
Task Distribution Layer
```

实现：

```
Owner

↓

拆分图片任务

↓

多个用户 WASM压缩

↓

结果合并
```

---

## V3 社区能力

增加：

* 用户系统
* 分享历史
* 排行榜
* 在线活动

---

# 13. V1 验收标准

完成以下功能即认为 V1 完成：

## 基础连接

* [ ] 用户 A 创建分享房间
* [ ] 用户 B 通过链接加入
* [ ] 双方成功建立 Realtime 连接

## 状态同步

* [ ] 加入事件同步
* [ ] 离开事件同步
* [ ] 在线状态同步

## 图片分享

* [ ] 单张图片发送
* [ ] 图片分片传输
* [ ] 图片完整恢复
* [ ] 大图片传输稳定

## 安全

* [ ] 图片不经过服务器存储
* [ ] 房间随机 ID
* [ ] 房间自动过期

---

# 总结

PicBind Realtime V1 的核心不是实现一个聊天系统，而是建立：

> 浏览器之间通过 Cloudflare Realtime 建立实时数据桥梁。

第一阶段通过图片分享验证：

* Cloudflare Realtime 接入
* DataChannel 通信
* 浏览器间二进制传输
* 临时会话管理

为后续：

* 协同压缩
* 多人协作
* 实时社区

提供基础能力。
