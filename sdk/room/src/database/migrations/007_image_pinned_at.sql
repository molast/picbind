ALTER TABLE room_images
  ADD COLUMN pinned_at INTEGER;

CREATE INDEX room_images_room_pinned_idx
  ON room_images(room_id, pinned_at DESC, updated_at DESC);
