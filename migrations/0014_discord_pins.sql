CREATE TABLE IF NOT EXISTS control_discord_pins (
 owner_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('server','dm','initialized')),
 id TEXT NOT NULL,
 name TEXT NOT NULL,
 PRIMARY KEY(owner_id,kind,id)
);
