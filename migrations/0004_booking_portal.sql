CREATE TABLE booking_types (
 slug TEXT PRIMARY KEY,
 settings TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1,
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL
);
ALTER TABLE booking_reservations ADD COLUMN booking_slug TEXT NOT NULL DEFAULT 'default';
ALTER TABLE booking_reservations ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE booking_reservations ADD COLUMN calendar_id TEXT;
CREATE TABLE booking_slot_locks (
 start_ms INTEGER PRIMARY KEY,
 reservation_id TEXT NOT NULL REFERENCES booking_reservations(id)
);
INSERT INTO booking_slot_locks(start_ms,reservation_id) SELECT start_ms,id FROM booking_reservations WHERE status!='cancelled';
INSERT INTO booking_slot_locks(start_ms,reservation_id) SELECT start_ms+900000,id FROM booking_reservations WHERE status!='cancelled';
CREATE TABLE booking_admin_sessions (
 token_hash TEXT PRIMARY KEY,
 csrf TEXT NOT NULL,
 expires_ms INTEGER NOT NULL,
 password_version TEXT NOT NULL
);
CREATE TABLE booking_rate_limits (
 key TEXT NOT NULL,
 bucket INTEGER NOT NULL,
 attempts INTEGER NOT NULL,
 PRIMARY KEY(key,bucket)
);
