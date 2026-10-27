-- Additive only: keep all accounts, vaults, posts, archives and existing prekeys.
CREATE TABLE protocol_devices (
 identity TEXT NOT NULL REFERENCES protocol_accounts(identity),
 token TEXT NOT NULL,
 device INTEGER NOT NULL,
 PRIMARY KEY(identity,token),
 UNIQUE(identity,device)
);
CREATE TABLE protocol_partner_origins (
 identity TEXT NOT NULL REFERENCES protocol_accounts(identity),
 partner TEXT NOT NULL,
 origin TEXT NOT NULL,
 PRIMARY KEY(identity,partner)
);
CREATE TABLE protocol_password_backups (
 identity TEXT PRIMARY KEY REFERENCES protocol_accounts(identity),
 encrypted TEXT NOT NULL
);
