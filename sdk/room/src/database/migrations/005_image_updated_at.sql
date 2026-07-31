ALTER TABLE room_images
  ADD COLUMN updated_at INTEGER;

UPDATE room_images
SET updated_at = created_at
WHERE updated_at IS NULL;

CREATE INDEX room_images_room_updated_idx
  ON room_images(room_id, updated_at ASC);
