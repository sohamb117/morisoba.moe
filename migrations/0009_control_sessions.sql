CREATE TABLE IF NOT EXISTS control_sessions (
 token_hash TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES mimori_users(id),
 google_uid TEXT NOT NULL,
 csrf TEXT NOT NULL,
 expires_ms INTEGER NOT NULL,
 created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS control_sessions_expiry ON control_sessions(expires_ms);
