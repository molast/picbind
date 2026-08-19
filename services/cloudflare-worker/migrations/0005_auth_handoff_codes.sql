PRAGMA foreign_keys = ON;

CREATE TABLE auth_handoff_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  return_origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX auth_handoff_codes_expires_at
  ON auth_handoff_codes(expires_at);

CREATE INDEX auth_handoff_codes_session_id
  ON auth_handoff_codes(session_id);
