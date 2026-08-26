use super::files;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_LIST_LIMIT: u32 = 1_000;
const MAX_PRUNE_LIMIT: u32 = 1_000;
const SCHEMA_VERSION: i64 = 2;
const DEFAULT_CACHE_MAX_BYTES: u64 = 512 * 1024 * 1024;
const DEFAULT_CACHE_MAX_AGE_MILLIS: i64 = 30 * 24 * 60 * 60 * 1_000;

#[derive(Clone)]
pub struct NativeImageStore {
    root: Arc<PathBuf>,
    connection: Arc<Mutex<Connection>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutImageRequest {
    pub scope: String,
    #[serde(default)]
    pub scope_key: String,
    pub id: String,
    pub metadata: Value,
    pub mime_type: String,
    #[serde(default)]
    pub data_length: usize,
    #[serde(default)]
    pub thumbnail_length: usize,
    #[serde(skip)]
    pub data: Option<Vec<u8>>,
    #[serde(skip)]
    pub thumbnail: Option<Vec<u8>>,
    pub thumbnail_mime_type: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImageRecord {
    pub scope: String,
    pub scope_key: String,
    pub id: String,
    pub metadata: Value,
    pub mime_type: String,
    pub byte_size: i64,
    pub revision: String,
    pub thumbnail_available: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub record_count: i64,
    pub total_bytes: i64,
    pub scopes: Vec<ScopeStorageUsage>,
    pub orphan_bytes: u64,
    pub temp_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeStorageUsage {
    pub scope: String,
    pub record_count: i64,
    pub primary_bytes: u64,
    pub thumbnail_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneCachePolicy {
    pub max_bytes: u64,
    #[serde(default)]
    pub max_age_millis: Option<i64>,
    #[serde(default = "default_prune_limit")]
    pub limit: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneResult {
    pub removed_records: u32,
    pub removed_thumbnails: u32,
    pub reclaimed_bytes: u64,
    pub remaining_cache_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryResult {
    pub removed_temp_files: u32,
    pub removed_orphan_files: u32,
    pub removed_missing_records: u32,
    pub cleared_missing_thumbnails: u32,
}

impl NativeImageStore {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(root.join("database")).map_err(|error| error.to_string())?;
        for directory in [
            "assets/compressed",
            "assets/room",
            "cache/messaging",
            "derived/thumbnails",
            "temp",
            "temp/queued",
        ] {
            fs::create_dir_all(root.join(directory)).map_err(|error| error.to_string())?;
        }

        let connection = Connection::open(root.join("database/picbind.sqlite"))
            .map_err(|error| error.to_string())?;
        connection
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .map_err(|error| error.to_string())?;
        let schema_version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if schema_version > SCHEMA_VERSION {
            return Err(format!(
                "image storage schema {schema_version} is newer than supported version {SCHEMA_VERSION}"
            ));
        }
        if schema_version == 0 {
            connection
                .execute_batch(
                    "BEGIN IMMEDIATE;
                 CREATE TABLE IF NOT EXISTS image_cache (
                   scope TEXT NOT NULL,
                   scope_key TEXT NOT NULL,
                   id TEXT NOT NULL,
                   metadata_json TEXT NOT NULL,
                   mime_type TEXT NOT NULL,
                   file_path TEXT,
                   thumbnail_path TEXT,
                   byte_size INTEGER NOT NULL,
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL,
                   last_accessed_at INTEGER,
                   PRIMARY KEY (scope, scope_key, id)
                 );
                 CREATE INDEX IF NOT EXISTS image_cache_scope_updated
                   ON image_cache(scope, scope_key, updated_at DESC);
                 CREATE INDEX IF NOT EXISTS image_cache_lru
                   ON image_cache(scope, last_accessed_at, updated_at);
                 PRAGMA user_version = 2;
                 COMMIT;",
                )
                .map_err(|error| error.to_string())?;
        } else if schema_version == 1 {
            connection
                .execute_batch(
                    "BEGIN IMMEDIATE;
                 CREATE INDEX IF NOT EXISTS image_cache_lru
                   ON image_cache(scope, last_accessed_at, updated_at);
                 PRAGMA user_version = 2;
                 COMMIT;",
                )
                .map_err(|error| error.to_string())?;
        }

        let store = Self {
            root: Arc::new(root),
            connection: Arc::new(Mutex::new(connection)),
        };
        store.recover()?;
        store.prune(PruneCachePolicy {
            max_bytes: DEFAULT_CACHE_MAX_BYTES,
            max_age_millis: Some(DEFAULT_CACHE_MAX_AGE_MILLIS),
            limit: default_prune_limit(),
        })?;
        Ok(store)
    }

    pub fn put(&self, request: PutImageRequest) -> Result<NativeImageRecord, String> {
        validate_identity(&request.scope, &request.scope_key, &request.id)?;
        if !request.mime_type.is_empty() && !request.mime_type.starts_with("image/") {
            return Err("image mime type is required".to_string());
        }
        let category = match request.scope.as_str() {
            "compressed" => "assets/compressed",
            "queued" => "temp/queued",
            "room" => "assets/room",
            "messaging" => "cache/messaging",
            _ => return Err("unsupported image storage scope".to_string()),
        };
        let stored = request
            .data
            .as_deref()
            .filter(|bytes| !bytes.is_empty())
            .map(|bytes| files::store(&self.root, category, &request.mime_type, bytes))
            .transpose()?;
        let thumbnail = match request.thumbnail.as_deref() {
            Some(bytes) if !bytes.is_empty() => Some(files::store(
                &self.root,
                "derived/thumbnails",
                request
                    .thumbnail_mime_type
                    .as_deref()
                    .unwrap_or("image/webp"),
                bytes,
            )?),
            _ => None,
        };

        let now = unix_millis()?;
        let metadata_json =
            serde_json::to_string(&request.metadata).map_err(|error| error.to_string())?;
        let mut connection = self.connection.lock().map_err(|error| error.to_string())?;
        let previous = connection
            .query_row(
                "SELECT file_path, thumbnail_path FROM image_cache
                 WHERE scope = ?1 AND scope_key = ?2 AND id = ?3",
                params![request.scope, request.scope_key, request.id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let fallback = if request.scope == "room"
            && stored.is_none()
            && previous
                .as_ref()
                .and_then(|(file_path, _)| file_path.as_ref())
                .is_none()
        {
            connection
                .query_row(
                    "SELECT file_path, byte_size FROM image_cache
                     WHERE scope = 'room' AND id = ?1 AND file_path IS NOT NULL
                     LIMIT 1",
                    [&request.id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()
                .map_err(|error| error.to_string())?
        } else {
            None
        };
        let incoming_path = stored
            .as_ref()
            .map(|file| file.relative_path.as_str())
            .or_else(|| fallback.as_ref().map(|(path, _)| path.as_str()));
        let incoming_byte_size = request.data.as_ref().map_or_else(
            || fallback.as_ref().map_or(0, |(_, size)| *size),
            |bytes| bytes.len() as i64,
        );
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let write_result = transaction.execute(
            "INSERT INTO image_cache (
               scope, scope_key, id, metadata_json, mime_type, file_path,
               thumbnail_path, byte_size, created_at, updated_at, last_accessed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
             ON CONFLICT(scope, scope_key, id) DO UPDATE SET
               metadata_json = excluded.metadata_json,
               mime_type = excluded.mime_type,
               file_path = COALESCE(excluded.file_path, image_cache.file_path),
               thumbnail_path = COALESCE(excluded.thumbnail_path, image_cache.thumbnail_path),
               byte_size = CASE
                 WHEN excluded.file_path IS NULL THEN image_cache.byte_size
                 ELSE excluded.byte_size
               END,
               updated_at = excluded.updated_at,
               last_accessed_at = excluded.last_accessed_at",
            params![
                request.scope,
                request.scope_key,
                request.id,
                metadata_json,
                request.mime_type,
                incoming_path,
                thumbnail.as_ref().map(|file| file.relative_path.as_str()),
                incoming_byte_size,
                request.created_at,
                now,
            ],
        );

        if let Err(error) = write_result {
            if let Some(stored) = stored.as_ref().filter(|file| file.created) {
                let _ = files::remove(&self.root, &stored.relative_path);
            }
            if let Some(thumbnail) = thumbnail.as_ref().filter(|file| file.created) {
                let _ = files::remove(&self.root, &thumbnail.relative_path);
            }
            return Err(error.to_string());
        }
        transaction.commit().map_err(|error| error.to_string())?;

        if let Some((old_file, old_thumbnail)) = previous {
            if let Some(old_file) = old_file {
                self.remove_if_unreferenced(
                    &connection,
                    &old_file,
                    incoming_path.unwrap_or(&old_file),
                )?;
            }
            if let Some(old_thumbnail) = old_thumbnail {
                self.remove_if_unreferenced(
                    &connection,
                    &old_thumbnail,
                    thumbnail
                        .as_ref()
                        .map(|file| file.relative_path.as_str())
                        .unwrap_or(""),
                )?;
            }
        }

        drop(connection);
        self.get(&request.scope, &request.scope_key, &request.id)?
            .ok_or_else(|| "stored image metadata was not found".to_string())
    }

    pub fn list(
        &self,
        scope: &str,
        scope_key: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<NativeImageRecord>, String> {
        validate_identity(scope, scope_key, "list")?;
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT scope, scope_key, id, metadata_json, mime_type, byte_size,
                        thumbnail_path IS NOT NULL, created_at, updated_at
                 FROM image_cache
                 WHERE scope = ?1 AND scope_key = ?2
                 ORDER BY updated_at DESC
                 LIMIT ?3 OFFSET ?4",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params![scope, scope_key, limit.clamp(1, MAX_LIST_LIMIT), offset],
                |row| {
                    let metadata_json: String = row.get(3)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        metadata_json,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, bool>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, i64>(8)?,
                    ))
                },
            )
            .map_err(|error| error.to_string())?;

        rows.map(|row| {
            let (scope, scope_key, id, metadata, mime_type, byte_size, thumbnail, created, updated) =
                row.map_err(|error| error.to_string())?;
            let revision = format!("{updated}:{byte_size}:{mime_type}");
            Ok(NativeImageRecord {
                scope,
                scope_key,
                id,
                metadata: serde_json::from_str(&metadata).map_err(|error| error.to_string())?,
                mime_type,
                byte_size,
                revision,
                thumbnail_available: thumbnail,
                created_at: created,
                updated_at: updated,
            })
        })
        .collect()
    }

    pub fn get(
        &self,
        scope: &str,
        scope_key: &str,
        id: &str,
    ) -> Result<Option<NativeImageRecord>, String> {
        validate_identity(scope, scope_key, id)?;
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let row = connection
            .query_row(
                "SELECT scope, scope_key, id, metadata_json, mime_type, byte_size,
                        thumbnail_path IS NOT NULL, created_at, updated_at
                 FROM image_cache
                 WHERE scope = ?1 AND scope_key = ?2 AND id = ?3",
                params![scope, scope_key, id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, bool>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, i64>(8)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;

        row.map(
            |(
                scope,
                scope_key,
                id,
                metadata,
                mime_type,
                byte_size,
                thumbnail,
                created,
                updated,
            )| {
                let revision = format!("{updated}:{byte_size}:{mime_type}");
                Ok(NativeImageRecord {
                    scope,
                    scope_key,
                    id,
                    metadata: serde_json::from_str(&metadata).map_err(|error| error.to_string())?,
                    mime_type,
                    byte_size,
                    revision,
                    thumbnail_available: thumbnail,
                    created_at: created,
                    updated_at: updated,
                })
            },
        )
        .transpose()
    }

    pub fn read(
        &self,
        scope: &str,
        scope_key: &str,
        id: &str,
        variant: &str,
    ) -> Result<Vec<u8>, String> {
        validate_identity(scope, scope_key, id)?;
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let column = match variant {
            "original" | "output" => "file_path",
            "thumbnail" => "thumbnail_path",
            _ => return Err("unsupported image variant".to_string()),
        };
        let sql = format!(
            "SELECT {column} FROM image_cache WHERE scope = ?1 AND scope_key = ?2 AND id = ?3"
        );
        let relative_path = connection
            .query_row(&sql, params![scope, scope_key, id], |row| {
                row.get::<_, Option<String>>(0)
            })
            .optional()
            .map_err(|error| error.to_string())?
            .flatten()
            .ok_or_else(|| "cached image was not found".to_string())?;
        connection
            .execute(
                "UPDATE image_cache SET last_accessed_at = ?4
                 WHERE scope = ?1 AND scope_key = ?2 AND id = ?3",
                params![scope, scope_key, id, unix_millis()?],
            )
            .map_err(|error| error.to_string())?;
        files::read(&self.root, &relative_path)
    }

    pub fn delete(&self, scope: &str, scope_key: &str, id: &str) -> Result<(), String> {
        validate_identity(scope, scope_key, id)?;
        let mut connection = self.connection.lock().map_err(|error| error.to_string())?;
        let paths = connection
            .query_row(
                "SELECT file_path, thumbnail_path FROM image_cache
                 WHERE scope = ?1 AND scope_key = ?2 AND id = ?3",
                params![scope, scope_key, id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((file_path, thumbnail_path)) = paths else {
            return Ok(());
        };

        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM image_cache WHERE scope = ?1 AND scope_key = ?2 AND id = ?3",
                params![scope, scope_key, id],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        if let Some(file_path) = file_path {
            self.remove_if_unreferenced(&connection, &file_path, "")?;
        }
        if let Some(thumbnail_path) = thumbnail_path {
            self.remove_if_unreferenced(&connection, &thumbnail_path, "")?;
        }
        Ok(())
    }

    pub fn delete_variant(
        &self,
        scope: &str,
        scope_key: &str,
        id: &str,
        variant: &str,
    ) -> Result<(), String> {
        validate_identity(scope, scope_key, id)?;
        let column = match variant {
            "original" | "output" => "file_path",
            "thumbnail" => "thumbnail_path",
            _ => return Err("unsupported image variant".to_string()),
        };
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let query = format!(
            "SELECT {column} FROM image_cache WHERE scope = ?1 AND scope_key = ?2 AND id = ?3"
        );
        let path = connection
            .query_row(&query, params![scope, scope_key, id], |row| {
                row.get::<_, Option<String>>(0)
            })
            .optional()
            .map_err(|error| error.to_string())?
            .flatten();
        let Some(path) = path else {
            return Ok(());
        };
        let update = format!(
            "UPDATE image_cache SET {column} = NULL WHERE scope = ?1 AND scope_key = ?2 AND id = ?3"
        );
        connection
            .execute(&update, params![scope, scope_key, id])
            .map_err(|error| error.to_string())?;
        self.remove_if_unreferenced(&connection, &path, "")
    }

    pub fn clear(&self, scope: &str, scope_key: Option<&str>) -> Result<(), String> {
        validate_identity(scope, scope_key.unwrap_or_default(), "clear")?;
        let mut connection = self.connection.lock().map_err(|error| error.to_string())?;
        let (query, delete) = if scope_key.is_some() {
            (
                "SELECT file_path, thumbnail_path FROM image_cache WHERE scope = ?1 AND scope_key = ?2",
                "DELETE FROM image_cache WHERE scope = ?1 AND scope_key = ?2",
            )
        } else {
            (
                "SELECT file_path, thumbnail_path FROM image_cache WHERE scope = ?1",
                "DELETE FROM image_cache WHERE scope = ?1",
            )
        };
        let key = scope_key.unwrap_or_default();
        let paths = {
            let mut statement = connection
                .prepare(query)
                .map_err(|error| error.to_string())?;
            let mut rows = if scope_key.is_some() {
                statement.query(params![scope, key])
            } else {
                statement.query(params![scope])
            }
            .map_err(|error| error.to_string())?;
            let mut paths = Vec::new();
            while let Some(row) = rows.next().map_err(|error| error.to_string())? {
                paths.push((
                    row.get::<_, Option<String>>(0)
                        .map_err(|error| error.to_string())?,
                    row.get::<_, Option<String>>(1)
                        .map_err(|error| error.to_string())?,
                ));
            }
            paths
        };
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        if scope_key.is_some() {
            transaction.execute(delete, params![scope, key])
        } else {
            transaction.execute(delete, params![scope])
        }
        .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;

        for (file_path, thumbnail_path) in paths {
            if let Some(file_path) = file_path {
                self.remove_if_unreferenced(&connection, &file_path, "")?;
            }
            if let Some(thumbnail_path) = thumbnail_path {
                self.remove_if_unreferenced(&connection, &thumbnail_path, "")?;
            }
        }
        Ok(())
    }

    pub fn usage(&self) -> Result<StorageUsage, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let record_count = connection
            .query_row("SELECT COUNT(*) FROM image_cache", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare("SELECT scope, file_path, thumbnail_path FROM image_cache")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let mut scope_paths: HashMap<String, (i64, HashSet<String>, HashSet<String>)> =
            HashMap::new();
        let mut referenced = HashSet::new();
        for row in rows {
            let (scope, file_path, thumbnail_path) = row.map_err(|error| error.to_string())?;
            let entry = scope_paths.entry(scope).or_default();
            entry.0 += 1;
            if let Some(path) = file_path {
                referenced.insert(path.clone());
                entry.1.insert(path);
            }
            if let Some(path) = thumbnail_path {
                referenced.insert(path.clone());
                entry.2.insert(path);
            }
        }
        drop(statement);
        drop(connection);

        let managed = files::list(
            &self.root,
            &[
                "assets/compressed",
                "assets/room",
                "cache/messaging",
                "derived/thumbnails",
                "temp",
            ],
        )?;
        let sizes: HashMap<_, _> = managed
            .iter()
            .map(|file| (file.relative_path.as_str(), file.byte_size))
            .collect();
        let total_bytes = managed.iter().map(|file| file.byte_size).sum::<u64>();
        let temp_bytes = managed
            .iter()
            .filter(|file| file.relative_path.starts_with("temp/"))
            .map(|file| file.byte_size)
            .sum();
        let orphan_bytes = managed
            .iter()
            .filter(|file| {
                !file.relative_path.starts_with("temp/")
                    && !referenced.contains(&file.relative_path)
            })
            .map(|file| file.byte_size)
            .sum();
        let mut scopes = scope_paths
            .into_iter()
            .map(|(scope, (count, primary, thumbnails))| ScopeStorageUsage {
                scope,
                record_count: count,
                primary_bytes: primary
                    .iter()
                    .filter_map(|path| sizes.get(path.as_str()))
                    .sum(),
                thumbnail_bytes: thumbnails
                    .iter()
                    .filter_map(|path| sizes.get(path.as_str()))
                    .sum(),
            })
            .collect::<Vec<_>>();
        scopes.sort_by(|left, right| left.scope.cmp(&right.scope));
        Ok(StorageUsage {
            record_count,
            total_bytes: i64::try_from(total_bytes).unwrap_or(i64::MAX),
            scopes,
            orphan_bytes,
            temp_bytes,
        })
    }

    pub fn prune(&self, policy: PruneCachePolicy) -> Result<PruneResult, String> {
        let limit = policy.limit.clamp(1, MAX_PRUNE_LIMIT);
        let now = unix_millis()?;
        let cutoff = policy
            .max_age_millis
            .map(|age| now.saturating_sub(age.max(0)));
        let cache_files = files::list(&self.root, &["cache/messaging", "derived/thumbnails"])?;
        let mut remaining = cache_files.iter().map(|file| file.byte_size).sum::<u64>();
        let sizes: HashMap<_, _> = cache_files
            .into_iter()
            .map(|file| (file.relative_path, file.byte_size))
            .collect();

        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT kind, scope, scope_key, id, path, accessed_at FROM (
                   SELECT 'record' AS kind, scope, scope_key, id, file_path AS path,
                          COALESCE(last_accessed_at, updated_at) AS accessed_at
                   FROM image_cache WHERE scope = 'messaging' AND file_path IS NOT NULL
                   UNION ALL
                   SELECT 'thumbnail', scope, scope_key, id, thumbnail_path,
                          COALESCE(last_accessed_at, updated_at)
                   FROM image_cache WHERE thumbnail_path IS NOT NULL
                 ) ORDER BY accessed_at ASC LIMIT ?1",
            )
            .map_err(|error| error.to_string())?;
        let candidates = statement
            .query_map([limit], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        drop(statement);
        drop(connection);

        let mut result = PruneResult {
            removed_records: 0,
            removed_thumbnails: 0,
            reclaimed_bytes: 0,
            remaining_cache_bytes: remaining,
        };
        for (kind, scope, scope_key, id, path, accessed_at) in candidates {
            let expired = cutoff.is_some_and(|value| accessed_at < value);
            if remaining <= policy.max_bytes && !expired {
                continue;
            }
            let bytes = sizes.get(&path).copied().unwrap_or(0);
            if kind == "record" {
                self.delete(&scope, &scope_key, &id)?;
                result.removed_records += 1;
            } else {
                self.remove_thumbnail(&scope, &scope_key, &id, &path)?;
                result.removed_thumbnails += 1;
            }
            remaining = remaining.saturating_sub(bytes);
            result.reclaimed_bytes = result.reclaimed_bytes.saturating_add(bytes);
        }
        result.remaining_cache_bytes = remaining;
        Ok(result)
    }

    pub fn recover(&self) -> Result<RecoveryResult, String> {
        let records = {
            let connection = self.connection.lock().map_err(|error| error.to_string())?;
            let mut statement = connection
                .prepare("SELECT scope, scope_key, id, file_path, thumbnail_path FROM image_cache")
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                })
                .map_err(|error| error.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?
        };
        let mut result = RecoveryResult {
            removed_temp_files: 0,
            removed_orphan_files: 0,
            removed_missing_records: 0,
            cleared_missing_thumbnails: 0,
        };
        for (scope, scope_key, id, file_path, thumbnail_path) in &records {
            if let Some(path) = file_path
                && files::metadata(&self.root, path)?.is_none()
            {
                if scope == "room" {
                    let connection = self.connection.lock().map_err(|error| error.to_string())?;
                    connection
                        .execute(
                            "UPDATE image_cache SET file_path = NULL, byte_size = 0
                             WHERE scope = ?1 AND scope_key = ?2 AND id = ?3",
                            params![scope, scope_key, id],
                        )
                        .map_err(|error| error.to_string())?;
                } else {
                    self.delete(scope, scope_key, id)?;
                    result.removed_missing_records += 1;
                    continue;
                }
            }
            if let Some(path) = thumbnail_path
                && files::metadata(&self.root, path)?.is_none()
            {
                let connection = self.connection.lock().map_err(|error| error.to_string())?;
                connection
                    .execute(
                        "UPDATE image_cache SET thumbnail_path = NULL
                         WHERE scope = ?1 AND scope_key = ?2 AND id = ?3",
                        params![scope, scope_key, id],
                    )
                    .map_err(|error| error.to_string())?;
                result.cleared_missing_thumbnails += 1;
            }
        }

        let referenced = self.referenced_paths()?;
        for file in files::list(
            &self.root,
            &[
                "assets/compressed",
                "assets/room",
                "cache/messaging",
                "derived/thumbnails",
            ],
        )? {
            if !referenced.contains(&file.relative_path) {
                files::remove(&self.root, &file.relative_path)?;
                result.removed_orphan_files += 1;
            }
        }
        for file in files::list(&self.root, &["temp"])? {
            if !referenced.contains(&file.relative_path) {
                files::remove(&self.root, &file.relative_path)?;
                result.removed_temp_files += 1;
            }
        }
        Ok(result)
    }

    fn referenced_paths(&self) -> Result<HashSet<String>, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare("SELECT file_path, thumbnail_path FROM image_cache")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let mut paths = HashSet::new();
        for row in rows {
            let (file, thumbnail) = row.map_err(|error| error.to_string())?;
            paths.extend(file);
            paths.extend(thumbnail);
        }
        Ok(paths)
    }

    fn remove_thumbnail(
        &self,
        scope: &str,
        scope_key: &str,
        id: &str,
        path: &str,
    ) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        connection
            .execute(
                "UPDATE image_cache SET thumbnail_path = NULL
                 WHERE scope = ?1 AND scope_key = ?2 AND id = ?3 AND thumbnail_path = ?4",
                params![scope, scope_key, id, path],
            )
            .map_err(|error| error.to_string())?;
        self.remove_if_unreferenced(&connection, path, "")
    }

    fn remove_if_unreferenced(
        &self,
        connection: &Connection,
        relative_path: &str,
        replacement: &str,
    ) -> Result<(), String> {
        if relative_path.is_empty() || relative_path == replacement {
            return Ok(());
        }
        let references: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM image_cache
                 WHERE file_path = ?1 OR thumbnail_path = ?1",
                [relative_path],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if references == 0 {
            files::remove(&self.root, relative_path)?;
        }
        Ok(())
    }
}

fn validate_identity(scope: &str, scope_key: &str, id: &str) -> Result<(), String> {
    if scope.is_empty()
        || scope.len() > 32
        || scope_key.len() > 256
        || id.is_empty()
        || id.len() > 512
    {
        return Err("invalid image storage identity".to_string());
    }
    if !matches!(scope, "compressed" | "queued" | "room" | "messaging") {
        return Err("unsupported image storage scope".to_string());
    }
    Ok(())
}

fn default_prune_limit() -> u32 {
    250
}

fn unix_millis() -> Result<i64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    i64::try_from(millis).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "picbind-native-storage-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ))
    }

    fn request(scope: &str, scope_key: &str, id: &str, data: Option<Vec<u8>>) -> PutImageRequest {
        PutImageRequest {
            scope: scope.to_string(),
            scope_key: scope_key.to_string(),
            id: id.to_string(),
            metadata: serde_json::json!({ "name": "sample.png", "createdAt": 10 }),
            mime_type: "image/png".to_string(),
            data_length: data.as_ref().map_or(0, Vec::len),
            thumbnail_length: 0,
            data,
            thumbnail: None,
            thumbnail_mime_type: None,
            created_at: 10,
        }
    }

    #[test]
    fn stores_reads_and_deletes_an_image() {
        let root = test_root("lifecycle");
        let store = NativeImageStore::open(root.clone()).expect("open store");
        store
            .put(request("compressed", "", "image-1", Some(vec![1, 2, 3])))
            .expect("put image");

        assert_eq!(
            store.read("compressed", "", "image-1", "output"),
            Ok(vec![1, 2, 3])
        );
        assert_eq!(store.list("compressed", "", 10, 0).expect("list").len(), 1);
        assert_eq!(store.usage().expect("usage").total_bytes, 3);

        store.delete("compressed", "", "image-1").expect("delete");
        assert!(
            store
                .get("compressed", "", "image-1")
                .expect("get")
                .is_none()
        );
        fs::remove_dir_all(root).expect("remove test storage");
    }

    #[test]
    fn room_metadata_update_preserves_existing_binary() {
        let root = test_root("room-update");
        let store = NativeImageStore::open(root.clone()).expect("open store");
        store
            .put(request("room", "room-1", "image-1", None))
            .expect("put placeholder");
        store
            .put(request("room", "room-1", "image-1", Some(vec![4, 5, 6])))
            .expect("put binary");
        store
            .put(request("room", "room-1", "image-1", None))
            .expect("update metadata");

        assert_eq!(
            store.read("room", "room-1", "image-1", "original"),
            Ok(vec![4, 5, 6])
        );
        assert_eq!(
            store
                .get("room", "room-1", "image-1")
                .expect("get")
                .expect("record")
                .byte_size,
            3
        );
        fs::remove_dir_all(root).expect("remove test storage");
    }

    #[test]
    fn room_variants_expire_independently() {
        let root = test_root("room-variants");
        let store = NativeImageStore::open(root.clone()).expect("open store");
        let mut value = request("room", "workspace", "image", Some(vec![1, 2, 3]));
        value.thumbnail = Some(vec![4, 5]);
        value.thumbnail_length = 2;
        store.put(value).expect("put room variants");

        store
            .delete_variant("room", "workspace", "image", "thumbnail")
            .expect("delete thumbnail");
        assert!(
            store
                .read("room", "workspace", "image", "thumbnail")
                .is_err()
        );
        assert_eq!(
            store.read("room", "workspace", "image", "original"),
            Ok(vec![1, 2, 3])
        );

        store
            .delete_variant("room", "workspace", "image", "original")
            .expect("delete source");
        assert!(
            store
                .read("room", "workspace", "image", "original")
                .is_err()
        );
        assert!(
            store
                .get("room", "workspace", "image")
                .expect("get metadata")
                .is_some()
        );
        fs::remove_dir_all(root).expect("remove test storage");
    }

    #[test]
    fn clears_a_scope_without_a_scope_key() {
        let root = test_root("clear");
        let store = NativeImageStore::open(root.clone()).expect("open store");
        store
            .put(request("queued", "", "image-1", Some(vec![1])))
            .expect("put first image");
        store
            .put(request("queued", "other", "image-2", Some(vec![2])))
            .expect("put second image");

        store.clear("queued", None).expect("clear scope");
        assert_eq!(store.usage().expect("usage").record_count, 0);
        fs::remove_dir_all(root).expect("remove test storage");
    }

    #[test]
    fn room_placeholder_reuses_binary_from_another_room() {
        let root = test_root("room-reference");
        let store = NativeImageStore::open(root.clone()).expect("open store");
        store
            .put(request("room", "room-1", "image-1", Some(vec![7, 8, 9])))
            .expect("put source image");
        store
            .put(request("room", "room-2", "image-1", None))
            .expect("put referenced image");

        assert_eq!(
            store.read("room", "room-2", "image-1", "original"),
            Ok(vec![7, 8, 9])
        );
        store
            .delete("room", "room-1", "image-1")
            .expect("delete source reference");
        assert_eq!(
            store.read("room", "room-2", "image-1", "original"),
            Ok(vec![7, 8, 9])
        );
        fs::remove_dir_all(root).expect("remove test storage");
    }

    #[test]
    fn migrates_schema_and_adds_lru_index() {
        let root = test_root("schema-migration");
        fs::create_dir_all(root.join("database")).expect("create database directory");
        let connection = Connection::open(root.join("database/picbind.sqlite")).expect("open db");
        connection
            .execute_batch(
                "CREATE TABLE image_cache (
                   scope TEXT NOT NULL, scope_key TEXT NOT NULL, id TEXT NOT NULL,
                   metadata_json TEXT NOT NULL, mime_type TEXT NOT NULL,
                   file_path TEXT, thumbnail_path TEXT, byte_size INTEGER NOT NULL,
                   created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                   last_accessed_at INTEGER,
                   PRIMARY KEY (scope, scope_key, id)
                 ); PRAGMA user_version = 1;",
            )
            .expect("create v1 schema");
        drop(connection);

        let store = NativeImageStore::open(root.clone()).expect("migrate store");
        let connection = store.connection.lock().expect("lock db");
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("schema version");
        assert_eq!(version, 2);
        let index_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index' AND name = 'image_cache_lru'",
                [],
                |row| row.get(0),
            )
            .expect("lru index");
        assert_eq!(index_count, 1);
        drop(connection);
        fs::remove_dir_all(root).expect("remove test storage");
    }

    #[test]
    fn prune_only_removes_cache_and_derived_files() {
        let root = test_root("prune");
        let store = NativeImageStore::open(root.clone()).expect("open store");
        store
            .put(request("compressed", "", "asset", Some(vec![1, 2, 3])))
            .expect("put managed asset");
        store
            .put(request("messaging", "room", "message", Some(vec![4, 5, 6])))
            .expect("put message cache");
        let mut room = request("room", "room", "room-image", Some(vec![7, 8, 9]));
        room.thumbnail = Some(vec![10, 11]);
        room.thumbnail_length = 2;
        store.put(room).expect("put derived thumbnail");

        let result = store
            .prune(PruneCachePolicy {
                max_bytes: 0,
                max_age_millis: None,
                limit: 20,
            })
            .expect("prune cache");
        assert_eq!(result.removed_records, 1);
        assert_eq!(result.removed_thumbnails, 1);
        assert!(
            store
                .get("compressed", "", "asset")
                .expect("get asset")
                .is_some()
        );
        assert!(
            store
                .get("room", "room", "room-image")
                .expect("get room image")
                .is_some()
        );
        fs::remove_dir_all(root).expect("remove test storage");
    }

    #[test]
    fn recovery_removes_orphans_and_missing_cache_records() {
        let root = test_root("recovery");
        let store = NativeImageStore::open(root.clone()).expect("open store");
        store
            .put(request("messaging", "room", "message", Some(vec![1, 2, 3])))
            .expect("put message");
        let path: String = store
            .connection
            .lock()
            .expect("lock db")
            .query_row(
                "SELECT file_path FROM image_cache WHERE scope = 'messaging'",
                [],
                |row| row.get(0),
            )
            .expect("stored path");
        files::remove(&root, &path).expect("remove cached file");
        fs::write(root.join("temp/abandoned.tmp"), [1]).expect("write temp orphan");
        fs::write(root.join("assets/compressed/orphan.png"), [2]).expect("write asset orphan");

        let result = store.recover().expect("recover store");
        assert_eq!(result.removed_missing_records, 1);
        assert_eq!(result.removed_temp_files, 1);
        assert_eq!(result.removed_orphan_files, 1);
        fs::remove_dir_all(root).expect("remove test storage");
    }
}
