ALTER TABLE room_images
  ADD COLUMN workspace_location TEXT NOT NULL DEFAULT 'outbox';
