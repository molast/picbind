PRAGMA foreign_keys = ON;

-- Authentication provisions one stable Workspace per User. This mapping is
-- only used to restore the Owner identity; realtime remains capability-based.
CREATE TABLE user_default_workspaces (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_capability TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX user_default_workspaces_workspace_id
  ON user_default_workspaces(workspace_id);
