CREATE TABLE IF NOT EXISTS ani_accounts (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL,
 disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ani_sessions (
 token_hash TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES ani_accounts(id) ON DELETE CASCADE,
 csrf TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ani_sessions_account ON ani_sessions(account_id);
CREATE TABLE IF NOT EXISTS ani_login_limits (
 key TEXT PRIMARY KEY,
 bucket INTEGER NOT NULL,
 attempts INTEGER NOT NULL
);
