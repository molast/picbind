CREATE TABLE IF NOT EXISTS queued_files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS compressed_images (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_size INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  format TEXT NOT NULL,
  size INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS compressed_images_created_at_idx
  ON compressed_images(created_at DESC);
