# Local Database

The PicBind UI package uses Dexie/IndexedDB for durable Workspace metadata and
OPFS for image bytes.

```text
UI -> repository -> Dexie -> IndexedDB
                  -> FileStorage -> OPFS
```

Responsibilities:

- `database.ts` owns the typed Dexie schema and database connection.
- `repositories/` is the only business-data access layer.
- `file-storage.ts` owns OPFS file operations.
- IndexedDB stores image metadata and review editor history. Workspace activity
  and operation logs are owned by the Workspace repository database.
- Image and thumbnail bytes are stored as OPFS files, never as Dexie records.
- Incoming and outgoing Weixin image metadata is stored in `workspaceMessagingImages`;
  image bytes are cached in OPFS immediately. The UI creates local Blob URLs
  from this cache and never persists expiring remote URLs. The cache keeps the
  latest 100 images per Workspace.

The UI package and Web app use the same `picbind-local` database name and V8
schema. V6 copies legacy records into Workspace-named tables, V7 removes the old
tables after the copy succeeds, and V8 removes the unused image-delivery table.
Session and transient UI state remain outside this database layer.
