# PicBind 本地数据库架构设计（Dexie + OPFS）

> 版本：V2
>
> 范围：仅描述浏览器端本地持久化，不涉及 Cloudflare Worker、D1 或其他远端数据库。

## 一、设计原则

- **Dexie / IndexedDB**：保存业务关联数据、状态、索引和历史记录。
- **OPFS**：保存图片、缩略图和临时文件等二进制数据。
- **Repository**：业务层访问持久化数据的唯一入口，负责协调元数据和文件操作。
- **Database**：集中定义 Dexie schema 和数据库生命周期。
- Blob 不写入 Dexie，数据库记录只保存 OPFS 路径及关联元数据。

## 二、整体架构

```text
React / Next.js / Room SDK
             │
             ▼
      Repository Layer
         │          │
         ▼          ▼
      Dexie       FileStorage
         │          │
         ▼          ▼
     IndexedDB      OPFS
     （元数据）    （二进制）
```

业务组件不得直接调用 Dexie、IndexedDB 或 OPFS。

## 三、目录结构

```text
src/database/
├── database.ts          # Dexie 实例、表类型和 schema
├── file-storage.ts      # OPFS 文件读写
├── repositories/        # 唯一数据访问层
└── types/               # 业务存储类型
```

不再使用 SQLite WASM、SQLite Worker、SQL migration 或 OPFS VFS。

## 四、数据边界

Dexie 保存：

- 压缩图片关联元数据
- 待处理文件元数据
- Room 图片关联和传输状态
- Review 操作历史及评论锚点
- Room 操作日志

OPFS 保存：

- 原图和处理后的图片
- 压缩结果
- 缩略图
- 待处理临时文件

## 五、Schema 管理

Dexie 使用 `database.version(n).stores(...)` 管理 schema 版本。后续表结构变化
必须增加版本，不得在同一版本下直接修改已发布 schema。升级逻辑仅用于 Dexie
自身结构演进，不迁移旧 SQLite 数据。

Web 与 Room SDK 使用相同的数据库名 `picbind-local`、相同版本和完整 store
声明，保证 Room 被 Web 引入时可以共享压缩结果元数据。

## 六、Repository 规则

- Repository 对外只暴露业务语义方法，不暴露 Dexie Table。
- 写入二进制时，先写 OPFS，再提交关联元数据。
- 删除记录时，同时清理对应 OPFS 文件。
- 读取发现 OPFS 文件缺失时，删除失效元数据，避免持续产生坏记录。
- 多表或批量一致性操作使用 Dexie transaction。
- 页面状态、临时交互状态继续使用 React state、sessionStorage 或 localStorage，
  不进入本地数据库。

## 七、远端数据库边界

本架构只替换浏览器端 SQLite。本次调整不修改 Cloudflare Worker、D1、远端房间
状态或线上 API。远端数据库与本地 Dexie 之间不存在自动迁移关系。
