ALTER TABLE workspaces
  ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1));

UPDATE workspaces
SET is_default = 1
WHERE id = (
  SELECT candidate.id
  FROM workspaces AS candidate
  WHERE candidate.owner_id = workspaces.owner_id
  ORDER BY candidate.created_at ASC, candidate.id ASC
  LIMIT 1
);

CREATE UNIQUE INDEX workspaces_one_default_per_owner
  ON workspaces(owner_id)
  WHERE is_default = 1;
