CREATE TABLE booking_admin_credentials (
 id INTEGER PRIMARY KEY CHECK(id=1),
 password_hash TEXT NOT NULL
);
