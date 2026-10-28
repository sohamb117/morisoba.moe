ALTER TABLE booking_reservations ADD COLUMN buffer_before INTEGER NOT NULL DEFAULT 0;
ALTER TABLE booking_reservations ADD COLUMN buffer_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE booking_reservations ADD COLUMN booking_day TEXT;
ALTER TABLE booking_reservations ADD COLUMN reminders INTEGER NOT NULL DEFAULT 0;
CREATE INDEX booking_day_limit ON booking_reservations(booking_slug,booking_day,status);
CREATE TABLE booking_reminder_deliveries (
 reservation_id TEXT NOT NULL REFERENCES booking_reservations(id),
 start_ms INTEGER NOT NULL,
 kind TEXT NOT NULL,
 recipient_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','sent','failed')),
 created_ms INTEGER NOT NULL,
 sent_ms INTEGER,
 PRIMARY KEY(reservation_id,start_ms,kind,recipient_hash)
);
ALTER TABLE booking_operations ADD COLUMN target_day TEXT;

CREATE VIEW booking_day_usage AS
 SELECT id,booking_slug,booking_day FROM booking_reservations WHERE status!='cancelled'
 UNION
 SELECT r.id,r.booking_slug,o.target_day FROM booking_operations o JOIN booking_reservations r ON r.id=o.reservation_id WHERE o.action='reschedule' AND r.status!='cancelled';
