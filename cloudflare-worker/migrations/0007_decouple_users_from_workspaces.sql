PRAGMA defer_foreign_keys = ON;

ALTER TABLE workspaces RENAME TO workspaces_user_linked;

DROP TABLE workspace_members;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO workspaces (id, share_id, name, created_at, updated_at)
SELECT id, share_id, name, created_at, updated_at
FROM workspaces_user_linked;

DROP TABLE workspaces_user_linked;

CREATE UNIQUE INDEX workspaces_share_id
  ON workspaces(share_id);
