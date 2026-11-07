CREATE TABLE IF NOT EXISTS control_spotify_oauth (
 state_hash TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL,
 encrypted_verifier TEXT NOT NULL,
 expires_ms INTEGER NOT NULL
);
