# PicBind 本地数据库架构设计（SQLite + OPFS）

> 版本：V1
>
> 目标：设计 PicBind 的本地数据存储架构，仅关注数据库与文件存储层，不涉及具体业务表设计。

---

# 一、设计原则

整个本地存储采用 **SQLite + OPFS** 架构。

职责划分如下：

- **SQLite**：负责存储业务状态（State）
- **OPFS**：负责持久化数据库文件及本地文件存储
- **Repository**：负责数据库访问
- **Migration**：负责数据库版本升级

整个业务层不直接操作 SQLite，也不直接访问数据库文件。

---

# 二、整体架构

```text
React / Next.js
        │
Repository Layer
        │
Database Layer
        │
SQLite (WASM)
        │
OPFS
```

---

# 三、项目目录结构

```text
src/
└── database/
    ├── client.ts              // SQLite 初始化
    ├── migration.ts           // Migration 管理
    ├── schema.ts              // 当前数据库版本
    │
    ├── repositories/          // Repository
    │
    ├── migrations/            // SQL Migration
    │   ├── 001_init.sql
    │   ├── 002_xxx.sql
    │   └── ...
    │
    └── types/
```

---

# 四、OPFS 目录规划

```text
/
├── database/
│   └── picbind.db
│
├── cache/
│
├── temp/
│
├── files/
│
└── thumbnails/
```

目录职责：

|目录|用途|
|----|----|
|database|SQLite 数据库文件|
|cache|缓存文件，可随时清理|
|temp|临时文件|
|files|持久化文件（未来可扩展）|
|thumbnails|缩略图文件|

---

# 五、SQLite 初始化流程

```text
启动应用

↓

打开 OPFS

↓

检查 database/

↓

不存在 picbind.db

↓

创建数据库

↓

执行 Migration

↓

Repository 可用
```

---

# 六、Migration

采用版本升级方式管理数据库结构。

推荐目录：

```text
migrations/

001_init.sql

002_xxx.sql

003_xxx.sql
```

升级流程：

```text
读取 user_version

↓

依次执行 Migration

↓

更新 Schema Version
```

所有数据库升级统一由 `migration.ts` 管理。

---

# 七、Database Client

整个项目仅维护一个 Database Client。

负责：

- SQLite 初始化
- OPFS 打开
- Migration
- Transaction
- Database 生命周期管理

Repository 不直接创建 SQLite 实例。

---

# 八、Repository

Repository 是数据库唯一访问入口。

职责：

- CRUD
- 查询
- Transaction 封装

业务层禁止直接执行 SQL。

推荐：

```text
Repository

↓

Database Client

↓

SQLite

↓

OPFS
```

---

# 九、职责划分

## Database Client

负责：

- 初始化数据库
- 打开数据库
- Migration
- Transaction
- 生命周期管理

---

## Repository

负责：

- 查询
- 新增
- 更新
- 删除

不负责：

- 文件管理
- OPFS 操作
- Migration

---

## Migration

负责：

- Schema Version
- SQL 升级
- 数据库结构演进

---

## OPFS

负责：

- SQLite 数据库文件
- 缓存文件
- 临时文件
- 缩略图
- 本地持久化资源

不负责业务逻辑。

---

# 十、最终架构

```text
React

↓

Repository

↓

Database Client

↓

SQLite (WASM)

↓

OPFS

database/
cache/
files/
temp/
thumbnails/
```

---

# 十一、设计原则总结

- SQLite 仅负责业务状态存储。
- OPFS 仅负责文件持久化。
- Repository 是数据库唯一访问入口。
- Database Client 统一管理数据库生命周期。
- Migration 统一管理数据库版本升级。
- 业务层不直接访问 SQLite。
- Repository 不直接操作 OPFS。
- 数据库与文件系统职责完全解耦，为未来接入 S3、R2、Google Drive、OneDrive 等存储方案预留扩展空间。