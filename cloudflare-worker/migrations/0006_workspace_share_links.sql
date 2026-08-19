ALTER TABLE workspaces
  ADD COLUMN share_id TEXT;

UPDATE workspaces
SET share_id = 'share_' || lower(hex(randomblob(24)))
WHERE share_id IS NULL;

CREATE UNIQUE INDEX workspaces_share_id
  ON workspaces(share_id);
