# Control plane

`/control/` is the administrative desktop. Calendar admin entry points redirect here. The homepage's shared chrome, HUD, fonts, window manager, materials, cable renderer, and scattered desktop coordinates are reused. Booking pages, editor, bookings, calendar status, invitations, members, moderation, account, password, and keyring are native DOM panels; no application iframes.

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
