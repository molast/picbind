CREATE TABLE room_images_v2 (
  id TEXT NOT NULL,
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
  root_image_id TEXT NOT NULL,
  parent_image_id TEXT,
  owner_id TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'local',
  operation TEXT NOT NULL DEFAULT 'original',
  version INTEGER NOT NULL DEFAULT 1,
  share_status TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, id)
);

INSERT INTO room_images_v2 (
  id, room_id, name, type, size, file_path, direction, transfer_status,
  progress, transfer_mode, preview_only, placeholder_only, placeholder_json,
  thumbnail_path, review_status, review_anchor_count, root_image_id,
  parent_image_id, owner_id, width, height, source, operation, version,
  share_status, created_at
)
SELECT
  id, room_id, name, type, size, file_path, direction, transfer_status,
  progress, transfer_mode, preview_only, placeholder_only, placeholder_json,
  thumbnail_path, review_status, review_anchor_count, id,
  NULL, '', 0, 0,
  CASE WHEN direction = 'received' THEN 'received' ELSE 'local' END,
  'original', 1,
  CASE WHEN direction = 'received' THEN 'available' ELSE 'local' END,
  created_at
FROM room_images;

DROP TABLE room_images;
ALTER TABLE room_images_v2 RENAME TO room_images;

CREATE INDEX room_images_room_created_idx
  ON room_images(room_id, created_at ASC);
CREATE INDEX room_images_root_version_idx
  ON room_images(room_id, root_image_id, version ASC);
