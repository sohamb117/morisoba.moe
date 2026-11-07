CREATE TABLE IF NOT EXISTS control_remilia_connection (
 id INTEGER PRIMARY KEY CHECK(id=1),
 client_id TEXT NOT NULL,
 generation TEXT NOT NULL,
 encrypted_token TEXT,
 account TEXT,
 refresh_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS control_remilia_oauth (
 state_hash TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL,
 generation TEXT NOT NULL,
 encrypted_request TEXT NOT NULL,
 expires_ms INTEGER NOT NULL
);

INSERT OR IGNORE INTO control_remilia_connection(id,client_id,generation) VALUES(1,'tpa-morisoba-control',lower(hex(randomblob(32))));
