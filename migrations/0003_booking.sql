CREATE TABLE booking_reservations (
 id TEXT PRIMARY KEY,
 start_ms INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cancelled')),
 cancel_token TEXT NOT NULL UNIQUE,
 created_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX booking_active_slot ON booking_reservations(start_ms) WHERE status != 'cancelled';
