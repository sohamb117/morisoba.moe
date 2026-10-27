-- Password changes commit the encrypted wrapper and account hash together.
-- Original protocol vaults remain untouched as migration backups.
CREATE TABLE mimori_identity_vaults (
 identity TEXT PRIMARY KEY,
 legacy_user TEXT NOT NULL UNIQUE REFERENCES mimori_users(id),
 revision INTEGER NOT NULL,
 encrypted TEXT NOT NULL
);
