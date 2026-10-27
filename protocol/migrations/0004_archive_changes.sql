-- Incremental private archive reads. Original encrypted rows are untouched.
CREATE TABLE protocol_archive_changes (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 identity TEXT NOT NULL REFERENCES protocol_accounts(identity),
 id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 UNIQUE(identity,id,revision)
);
CREATE INDEX protocol_archive_changes_owner ON protocol_archive_changes(identity,sequence);
INSERT INTO protocol_archive_changes(identity,id,revision) SELECT identity,id,revision FROM protocol_archives ORDER BY identity,id;
