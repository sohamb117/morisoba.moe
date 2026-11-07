CREATE TABLE IF NOT EXISTS control_app_connections (
 provider TEXT PRIMARY KEY,
 encrypted_token TEXT NOT NULL,
 account TEXT NOT NULL,
 updated_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS control_rss_subscriptions (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 url TEXT NOT NULL UNIQUE,
 enabled INTEGER NOT NULL DEFAULT 1,
 created_ms INTEGER NOT NULL
);
