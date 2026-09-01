# PicBind UI/UX 设计文档（V2）

> Version: 2.0
> Module: Workspace / Review Workspace
> Status: Draft

---

# 一、设计目标

PicBind 的定位不是聊天软件，也不是白板工具。

PicBind 的核心定位：

> **让用户快速分享图片，并进入实时协作讨论。**

因此整个产品划分为两个完全不同的工作模式：

```
Gallery（图片管理）
        ↓
Review（实时协作）
```

Gallery 负责图片流转。

Review 负责图片协作。

二者职责清晰，不相互干扰。

---

# 二、整体页面结构

整体页面仍然保持左右布局。

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  Workspace                              Workspace Panel            │
│                                                               │
│                                       ┌───────────────────┐   │
│                                       │ Participants      │   │
│                                       ├───────────────────┤   │
│                                       │ Activity          │   │
│                                       ├───────────────────┤   │
│                                       │ Chat Input        │   │
│                                       ├───────────────────┤   │
│                                       │ Emoji             │   │
│                                       └───────────────────┘   │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

左侧负责图片。

右侧负责工作区。

---

# 三、Workspace

Workspace 为左侧主要区域。

根据不同状态切换不同模式。

```
Gallery
↓

Review
```

---

# 四、Gallery 模式

## 定位

图片管理。

负责：

* 上传
* 接收
* 下载
* 删除
* 查看

保持现在的操作逻辑。

---

## UI

```
Workspace

────────────────────────────

□

□

□

□

□

□

────────────────────────────
```

每张图片显示：

```
缩略图

文件名

大小

发送状态
```

例如：

```
┌─────────────┐

 图片

cat.png

2.1 MB

Sent

────────────────

Download

Review

Delete

└─────────────┘
```

新增：

Review 按钮。

---

# 五、进入 Review

点击：

```
Review
```

或者：

```
双击图片
```

进入：

```
Review Workspace
```

Gallery 隐藏。

Workspace 切换。

---

# 六、Review Workspace

Review 模式专注于单张图片协作。

```
┌──────────────────────────────────────────────┐

 Toolbar

──────────────────────────────────────────────

 Image

──────────────────────────────────────────────

 Status

└──────────────────────────────────────────────┘
```

整个区域只展示一张图片。

---

# 七、Toolbar

Toolbar 固定顶部。

```
🖱 Select

➡ Arrow

▭ Rectangle

◯ Circle

✏ Pen

T Text

😊 Emoji

🔴 Laser

──────────────

＋ Zoom

Fit

Reset

Follow

Present
```

后续所有协作能力均扩展至 Toolbar。

---

# 八、Image Canvas

图片采用全屏 Canvas 展示。

Canvas 分为：

```
Image Layer

↓

Annotation Layer

↓

Pointer Layer
```

图片永远不会修改。

所有内容均绘制 Overlay。

---

# 九、Annotation

支持：

```
Arrow

Rectangle

Circle

Pen

Text

Emoji
```

特点：

* 实时同步
* 独立对象
* 可删除
* 可编辑（后续）

所有批注采用图片坐标系。

任何设备位置保持一致。

---

# 十、Live Pointer

所有在线成员实时显示鼠标。

例如：

```
Tom

⬆

Lucy

⬇
```

特点：

* 不同颜色
* 自动隐藏
* 实时移动

支持：

Laser Pointer。

按住快捷键后显示激光点。

---

# 十一、Viewport

支持：

```
Zoom

Pan

Fit

Reset
```

新增：

```
Follow Presenter
```

开启后：

所有成员同步：

* 缩放
* 平移

关闭后：

自由浏览。

---

# 十二、顶部信息栏

图片顶部显示：

```
← Back

cat.png

100%

Follow

Present

Participants
```

其中：

Participants：

```
● Tom

● Lucy

● Jack
```

实时显示：

在线状态。

---

# 十三、底部状态栏

展示图片信息。

```
PNG

4000 × 3000

4.2 MB

↓

Compressed

↓

3.1 MB
```

方便查看当前图片状态。

---

# 十四、Workspace Panel

Workspace Panel 不再定义为聊天区域。

统一升级为：

```
Workspace Panel
```

包含：

```
Participants

↓

Activity

↓

Chat

↓

Emoji
```

---

# 十五、Participants

顶部展示成员。

```
● Tom

Presenter

Latency

18 ms

────────────

● Lucy

Following

Latency

21 ms
```

后续支持：

* 在线状态
* P2P
* TURN
* 网络质量

---

# 十六、Activity

Activity 用于展示整个工作区事件。

例如：

```
Tom uploaded

cat.png

────────────

Lucy entered Review

────────────

Tom added Arrow

────────────

Lucy downloaded image

────────────

Presenter changed

────────────

Tom exited Review
```

Activity 不可编辑。

仅展示事件。

---

# 十七、Chat

保留简单聊天。

仅用于：

```
短文本

讨论

回复
```

不承担系统消息。

---

# 十八、Emoji

保留现在功能。

快速发送：

```
👍

❤️

🎉

😂
```

支持：

点击图片直接放置 Emoji。

---

# 十九、完整流程

## Step 1

创建工作区。

```
Create Workspace
```

---

## Step 2

上传图片。

```
Upload

↓

Gallery
```

---

## Step 3

发送图片。

```
Gallery

↓

Peer
```

---

## Step 4

收到图片。

Gallery 自动展示。

---

## Step 5

点击：

```
Review
```

进入：

```
Review Workspace
```

---

## Step 6

开始协作。

```
Pointer

↓

Annotation

↓

Chat

↓

Emoji

↓

Viewport Sync
```

---

## Step 7

退出 Review。

```
Back

↓

Gallery
```

继续分享其它图片。

---

# 二十、未来扩展

Review Workspace 后续可直接扩展：

* AI 图片分析
* AI 自动标注
* 评论线程
* 审批模式
* 图层管理
* 历史版本
* 撤销 / 重做
* 批注权限
* 多图片 Review
* 演示模式
* 导出带批注图片
* 导出 PDF

无需重新设计 UI。

---

# 二十一、设计原则

## Gallery

负责：

> 图片流转。

尽可能简单。

---

## Review

负责：

> 图片协作。

所有高级功能全部放在这里。

---

## Workspace Panel

负责：

> 工作区信息。

不承担图片编辑。

---

## Toolbar

负责：

> 所有协作工具。

避免工具散落到页面各处。

---

## 最终产品理念

PicBind 的核心体验应遵循一条简单自然的用户路径：

```
分享图片
      ↓
进入 Review
      ↓
实时讨论
      ↓
退出 Review
      ↓
继续分享下一张图片
```

整个产品围绕这一条主流程展开，而不是演变成复杂的聊天软件或通用白板工具。Review Workspace 是 PicBind 的核心价值，Gallery 是入口，Workspace Panel 是协作辅助，两者共同构成一套轻量、高效、专注于图片协作的实时工作空间。
