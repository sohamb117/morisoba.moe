-- Apply ONLY to the separate MIMORI_PROTOCOL_DB binding. Legacy data is untouched.
CREATE TABLE protocol_records (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 author TEXT NOT NULL,
 kind TEXT NOT NULL,
 recipient TEXT,
 record TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX protocol_author ON protocol_records(author,sequence);
CREATE INDEX protocol_inbox ON protocol_records(recipient,sequence);
CREATE TABLE protocol_accounts (
 identity TEXT PRIMARY KEY,
 legacy_user TEXT NOT NULL UNIQUE,
 public_key TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE protocol_vaults (
 identity TEXT PRIMARY KEY REFERENCES protocol_accounts(identity),
 revision INTEGER NOT NULL,
 encrypted TEXT NOT NULL
);
CREATE TABLE protocol_prekeys (
 id TEXT PRIMARY KEY,
 identity TEXT NOT NULL REFERENCES protocol_accounts(identity),
 device TEXT NOT NULL,
 ec_id INTEGER NOT NULL,
 kem_id INTEGER NOT NULL,
 bundle TEXT NOT NULL,
 claimed_by TEXT,
 claim_id TEXT UNIQUE,
 UNIQUE(identity,device,ec_id),
 UNIQUE(identity,device,kem_id)
);
CREATE TABLE protocol_challenges (
 id TEXT PRIMARY KEY,
 identity TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE protocol_links (
 request_id TEXT PRIMARY KEY,
 sender TEXT NOT NULL,
 recipient TEXT NOT NULL,
 accepted INTEGER NOT NULL DEFAULT 0,
 revoked INTEGER NOT NULL DEFAULT 0,
 UNIQUE(sender,recipient)
);
CREATE TABLE protocol_limits (identity TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
