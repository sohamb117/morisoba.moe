ALTER TABLE booking_reservations ADD COLUMN email_key TEXT;
CREATE INDEX booking_email_limits ON booking_reservations(email_key,status,start_ms,created_ms);
CREATE TABLE booking_verifications (
 id TEXT PRIMARY KEY,
 email_hash TEXT NOT NULL,
 code_hash TEXT NOT NULL,
 expires_ms INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 consumed_ms INTEGER
);
CREATE INDEX booking_verification_expiry ON booking_verifications(expires_ms);
CREATE TABLE booking_abuse_limits (
 key TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 reset_ms INTEGER NOT NULL
);
