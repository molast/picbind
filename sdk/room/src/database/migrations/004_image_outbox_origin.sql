ALTER TABLE room_images
  ADD COLUMN outbox_origin TEXT NOT NULL DEFAULT 'direct';

UPDATE room_images
SET outbox_origin = 'received'
WHERE direction = 'received';
