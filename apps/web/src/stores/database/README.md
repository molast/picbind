# Local Database

The Web app uses Dexie/IndexedDB for durable metadata and OPFS for image bytes.

```text
UI -> repository -> Dexie -> IndexedDB
                  -> FileStorage -> OPFS
```

Responsibilities:

- `database.ts` owns the typed Dexie schema and database connection.
- `repositories/` is the only business-data access layer.
- `file-storage.ts` owns OPFS file operations.
- IndexedDB stores compression and queued-file metadata.
- Image bytes are stored as OPFS files, never as Dexie records.

The Web app and PicBind UI package use the same `picbind-local` database name and
V8 schema. Session and transient UI state remain outside this database layer.
