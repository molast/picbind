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

CREATE TABLE IF NOT EXISTS room_images (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  file_path TEXT,
  direction TEXT NOT NULL,
  transfer_status TEXT,
  progress REAL,
  transfer_mode TEXT,
  preview_only INTEGER NOT NULL DEFAULT 0,
  placeholder_only INTEGER NOT NULL DEFAULT 0,
  placeholder_json TEXT,
  thumbnail_path TEXT,
  review_status TEXT,
  review_anchor_count INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS room_images_room_created_idx
  ON room_images(room_id, created_at ASC);

CREATE TABLE IF NOT EXISTS review_histories (
  room_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  operations_json TEXT NOT NULL,
  anchors_json TEXT NOT NULL DEFAULT '[]',
  cursor INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, image_id)
);
