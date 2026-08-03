# Local Database

Room SDK uses Dexie/IndexedDB for durable metadata and OPFS for image bytes.

```text
UI -> repository -> Dexie -> IndexedDB
                  -> FileStorage -> OPFS
```

Responsibilities:

- `database.ts` owns the typed Dexie schema and database connection.
- `repositories/` is the only business-data access layer.
- `file-storage.ts` owns OPFS file operations.
- IndexedDB stores metadata, review history, and operation logs.
- Image and thumbnail bytes are stored as OPFS files, never as Dexie records.

The Room SDK and Web app use the same `picbind-local` database name and schema
version so compressed-image metadata remains available when Room is embedded in
Web. Session and transient UI state remain outside this database layer.
