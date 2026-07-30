# Local Database

PicBind uses SQLite WASM and OPFS for durable browser data.

```text
UI -> compatibility store -> repository -> DatabaseClient -> SQLite Worker -> OPFS
                                  |
                                  -> FileStorage -> OPFS
```

Responsibilities:

- `client.ts` owns the single SQLite Worker connection.
- `sqlite.worker.ts` is the only module that opens `database/picbind.db`.
- `migration.ts` applies ordered SQL migrations using `PRAGMA user_version`.
- `repositories/` is the only business-data access layer.
- `file-storage.ts` owns OPFS file operations.
- SQLite stores metadata and review history; image bytes are stored as OPFS files.

OPFS layout:

```text
/database/picbind.db
/cache
/temp/compression
/files/compressed
/files/rooms
/thumbnails/rooms
```

Session and UI state remain in `localStorage` or `sessionStorage`; they are not
part of this database layer.
