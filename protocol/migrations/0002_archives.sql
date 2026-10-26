CREATE TABLE protocol_archives (
 identity TEXT NOT NULL REFERENCES protocol_accounts(identity),
 id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 encrypted TEXT NOT NULL,
 PRIMARY KEY(identity,id)
);
