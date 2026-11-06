# Control plane

`/control/` is the administrative desktop. Calendar admin entry points redirect here. It reuses the homepage’s fonts and window materials, with an app launcher and independent native DOM windows. No wires or application iframes.

The sign-in screen reuses Copland OS Enterprise styling, with User, Password, and one Admin button. It accepts the configured username or email. The password goes directly to Google Cloud Identity Platform email/password authentication. The Worker verifies the resulting signed ID token, project issuer/audience/expiry, recent authentication, exact owner UID/email, and current Identity Platform account before issuing a one-hour HttpOnly session. GCP project: `personal-use-493017`. Public registration is disabled.

## Configuration

- `CONTROL_AUTH_REQUIRED=true`
- `GCP_AUTH_PROJECT_ID`, `GCP_AUTH_API_KEY` (public API key restricted to authentication APIs)
- `CONTROL_GCP_UID`, `CONTROL_OWNER_ID`, `CONTROL_OWNER_EMAIL`, `CONTROL_USERNAME`
- Apply `0009_control_sessions.sql` before enabling authentication.

The GCP UID maps to the existing, enabled D1 owner account. Role and disabled status are checked on every authenticated request. The same opaque session and CSRF token authorize calendar, community, and protocol account endpoints. Legacy calendar password login and community owner password sessions cannot grant administrative access when enabled. Ordinary community member accounts are unchanged.

Logout revokes the session across all administrative panels. Password changes use GCP reauthentication and password update, then revoke all control sessions. Sessions expire after one hour; changing or disabling an account directly in GCP prevents new sessions, while already-issued control sessions last until expiry unless explicitly revoked in D1.

## Keyring

Authentication does not decrypt an existing encrypted Mimori keyring. Its existing passphrase unlocks it locally through the original crypto worker. This is an encryption unlock, not an alternative authorization mechanism. The control plane does not store the passphrase or replace encryption keys. Standalone Mimori can unlock the same keyring after control authentication.

## Verification and release

Run `npm test`, `npm run build:protocol`, and `wrangler deploy --dry-run`. Tests cover native routing, no application framing, cryptographic token validation, unified authorization, CSRF, expiry, disabled owners, logout, and rejection of old admin credentials. Browser QA uses local test data; no live bookings, invitations, or member changes are needed.

Existing unrelated Turnstile edits in the source checkout must not be included in this release.

## App launcher

The desktop starts with no open windows. `control/app.js` passes `{name, launch}` entries to `registerApps` in `control/desktop.js`. Add one entry and its native window to add an app. There are no wires, iframes, or automatic scattered panels. The dock contains running apps; minimizing keeps their state, and closing removes the dock entry while retaining drafts for reopening.

Current apps: Calendar, Mimori-Chat, Mimori-Admin, Upcoming Events, Booking Manager. Account and password controls are inside Mimori-Admin. Mimori-Chat includes the encrypted keyring, timeline, posting, threaded replies, reactions, sync and retry. Its keyring passphrase decrypts the existing identity; it is not a second administrative login.

Calendar uses authenticated server routes under `/api/control/calendar/`: day/week/month/agenda, calendar selection, search within the displayed agenda range, timezone selection, expanded recurring occurrences, details, create/edit/delete, all-day and multi-day events, recurrence rules, guests and RSVP, Meet creation, visibility, availability, colors and reminders. Dragging events to a new day or hour opens the editor for confirmation. Edits use etags and preserve guest RSVP metadata. Recurring changes support one occurrence or the entire series. Booking-managed events must be changed through Booking Manager so reservations stay consistent. Upcoming Events displays the next 30 days from the selected calendars.

This is a native Calendar API client, not a complete replica of every Google Calendar product feature: Tasks, calendar sharing/settings, and splitting a recurring series at “this and following” are not implemented. Existing attachments and meeting links can be viewed; attachment upload is not implemented.

## Calendar reconnect

Apply `0010_control_calendar.sql` before deploying. The existing booking OAuth token lacks calendar-list access. From Calendar, choose Connect calendars to grant `calendar.events` and `calendar.calendarlist.readonly` to the existing Morisoba Calendar OAuth client. Its registered callback is `https://morisoba.moe/api/control/calendar/callback`.

Reconnect requires an owner session and CSRF; callback state is single-use, expires after ten minutes, is bound to the browser and active owner session, and uses PKCE. The connected primary Google account must match `CONTROL_OWNER_EMAIL`. The new calendar-only refresh token is encrypted with AES-GCM using an HKDF-derived key from the existing server-side OAuth client secret, and stored in D1. OAuth client secrets and refresh tokens never reach frontend code or source control. Keep the existing client secret stable, or reconnect after rotation. The existing booking/reminder token is not replaced.
