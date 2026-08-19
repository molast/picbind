PRAGMA defer_foreign_keys = ON;

-- Password credentials keep their User. OAuth identities attached to a password
-- User, and all but one identity on an OAuth-only User, move to independent Users.
-- D1 does not allow TEMP tables in remote migrations. This ordinary helper
-- table is removed before the migration completes.
CREATE TABLE migration_0004_oauth_identity_splits (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  old_user_id TEXT NOT NULL,
  new_user_id TEXT NOT NULL,
  new_workspace_id TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);

INSERT INTO migration_0004_oauth_identity_splits (
  provider,
  provider_user_id,
  old_user_id,
  new_user_id,
  new_workspace_id
)
WITH ranked_identities AS (
  SELECT
    identity.provider,
    identity.provider_user_id,
    identity.user_id,
    ROW_NUMBER() OVER (
      PARTITION BY identity.user_id
      ORDER BY identity.created_at ASC, identity.provider ASC, identity.provider_user_id ASC
    ) AS identity_number,
    EXISTS (
      SELECT 1
      FROM auth_credentials credential
      WHERE credential.user_id = identity.user_id
    ) AS has_password
  FROM auth_identities identity
)
SELECT
  provider,
  provider_user_id,
  user_id,
  'oauth-user-' || lower(hex(randomblob(16))),
  'oauth-workspace-' || lower(hex(randomblob(16)))
FROM ranked_identities
WHERE has_password = 1 OR identity_number > 1;

ALTER TABLE users RENAME TO users_legacy;
ALTER TABLE auth_credentials RENAME TO auth_credentials_legacy;
ALTER TABLE auth_sessions RENAME TO auth_sessions_legacy;
ALTER TABLE workspaces RENAME TO workspaces_legacy;
ALTER TABLE workspace_members RENAME TO workspace_members_legacy;
ALTER TABLE auth_identities RENAME TO auth_identities_legacy;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  avatar TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO users (id, email, name, avatar, created_at, updated_at)
SELECT
  user.id,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM auth_credentials_legacy credential WHERE credential.user_id = user.id
    ) THEN user.email
    ELSE NULL
  END,
  user.name,
  user.avatar,
  user.created_at,
  user.updated_at
FROM users_legacy user;

INSERT INTO users (id, email, name, avatar, created_at, updated_at)
SELECT
  split.new_user_id,
  NULL,
  user.name,
  user.avatar,
  identity.created_at,
  identity.updated_at
FROM migration_0004_oauth_identity_splits split
JOIN users_legacy user ON user.id = split.old_user_id
JOIN auth_identities_legacy identity
  ON identity.provider = split.provider
  AND identity.provider_user_id = split.provider_user_id;

CREATE TABLE auth_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_algorithm TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO auth_credentials
SELECT * FROM auth_credentials_legacy;

-- Sessions are intentionally not copied. Every client must authenticate again
-- after identity ownership changes.
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
);

INSERT INTO workspaces
SELECT * FROM workspaces_legacy;

INSERT INTO workspaces (
  id,
  owner_id,
  name,
  created_at,
  updated_at,
  is_default
)
SELECT
  split.new_workspace_id,
  split.new_user_id,
  'My Workspace',
  identity.created_at,
  identity.updated_at,
  1
FROM migration_0004_oauth_identity_splits split
JOIN auth_identities_legacy identity
  ON identity.provider = split.provider
  AND identity.provider_user_id = split.provider_user_id;

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

INSERT INTO workspace_members
SELECT * FROM workspace_members_legacy;

INSERT INTO workspace_members (workspace_id, user_id, created_at)
SELECT split.new_workspace_id, split.new_user_id, identity.created_at
FROM migration_0004_oauth_identity_splits split
JOIN auth_identities_legacy identity
  ON identity.provider = split.provider
  AND identity.provider_user_id = split.provider_user_id;

CREATE TABLE auth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (provider, user_id)
);

INSERT INTO auth_identities (
  provider,
  provider_user_id,
  user_id,
  created_at,
  updated_at
)
SELECT
  identity.provider,
  identity.provider_user_id,
  COALESCE(split.new_user_id, identity.user_id),
  identity.created_at,
  identity.updated_at
FROM auth_identities_legacy identity
LEFT JOIN migration_0004_oauth_identity_splits split
  ON split.provider = identity.provider
  AND split.provider_user_id = identity.provider_user_id;

DROP TABLE workspace_members_legacy;
DROP TABLE workspaces_legacy;
DROP TABLE auth_identities_legacy;
DROP TABLE auth_sessions_legacy;
DROP TABLE auth_credentials_legacy;
DROP TABLE users_legacy;

CREATE INDEX auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at ON auth_sessions(expires_at);
CREATE INDEX workspaces_owner_id ON workspaces(owner_id);
CREATE UNIQUE INDEX workspaces_one_default_per_owner
  ON workspaces(owner_id)
  WHERE is_default = 1;
CREATE INDEX workspace_members_user_id ON workspace_members(user_id);
CREATE INDEX auth_identities_user_id ON auth_identities(user_id);

DROP TABLE migration_0004_oauth_identity_splits;

PRAGMA foreign_key_check;
