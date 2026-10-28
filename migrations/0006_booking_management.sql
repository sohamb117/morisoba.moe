CREATE TABLE booking_operations (
 reservation_id TEXT PRIMARY KEY REFERENCES booking_reservations(id),
 operation_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('cancel','reschedule')),
 target_start_ms INTEGER,
 created_ms INTEGER NOT NULL
);
