# Booking at /book/

Native HTML/JS using shared chrome and typography. Worker APIs check Google Calendar free/busy and create invitations. Visitors need no Google login.

## Enable

1. Apply migration to the existing database:
   npx wrangler d1 migrations apply morisoba-mimorigasaka --remote
2. Create a Google OAuth web application with Calendar API enabled. Authorize the host account for offline access with scopes https://www.googleapis.com/auth/calendar.events and https://www.googleapis.com/auth/calendar.freebusy. Store these Worker secrets:
   - BOOKING_GOOGLE_CLIENT_ID
   - BOOKING_GOOGLE_CLIENT_SECRET
   - BOOKING_GOOGLE_REFRESH_TOKEN
   - BOOKING_CALENDAR_ID (usually primary)
3. Optionally set BOOKING_TIMEZONE (defaults to America/New_York). Defaults: weekdays 13:00–17:00 host time, 30-minute slots, 24-hour notice, 30-day horizon. Adjust validSlot in middleware/booking.mjs.
4. Deploy with the existing Cloudflare integration. Verify slots, a real invitation, and cancellation against the host calendar.

Without configuration the UI explicitly says booking is not open. GitHub Pages alone cannot run the API. Secrets stay server-side. No homepage navigation is changed until booking is ready.

## Persistence and conflicts

booking_reservations stores event ID, start, status, random cancellation token and creation time. Guest name/email/notes live in Google Calendar. A partial unique index atomically prevents two app requests claiming the same half-hour. Calendar is checked immediately before reservation. External calendar edits can still race this check: Google offers no atomic free/busy plus insertion.

An ambiguous Calendar or confirmation failure keeps the slot pending to prevent duplicate invitations. Reconcile pending rows manually using the row's event ID: mark confirmed if the event exists; otherwise mark cancelled to release. Never release solely by age.

Cancellation uses a long bearer token in the URL fragment; treat the saved link as private. Google sends invitations/cancellations through sendUpdates=all. Confirmation offers an ICS download and cancellation link. Rescheduling means cancelling and booking again. Automatic reminders and Meet generation are not implemented.

Before public launch, configure Cloudflare rate limiting/Turnstile on the reservation API to control invitation spam. The honeypot only filters basic bots.

## Checks

node --test tests/booking.test.mjs
node --check middleware/booking.mjs
node --check book/app.js
