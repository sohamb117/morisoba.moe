CREATE TABLE IF NOT EXISTS control_calendar_connection (
 id INTEGER PRIMARY KEY CHECK(id=1),
 encrypted_token TEXT NOT NULL,
 updated_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS control_calendar_oauth (
 state_hash TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL,
 encrypted_verifier TEXT NOT NULL,
 expires_ms INTEGER NOT NULL
);
