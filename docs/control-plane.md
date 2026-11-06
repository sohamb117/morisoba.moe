# Control plane

`https://morisoba.moe/control/` hosts the administrative desktop. `/admin/`, `/book/admin/`, and the calendar host's `/admin/` redirect there with Calendar selected.

The desktop uses the homepage's `shared/chrome.js`, `chrome.css`, and typography: draggable windows, connected cables, minimize controls, and the closed-window dock. Panels remain mounted when closed, preserving unsaved forms. Each window also has maximize/restore and a standalone link. On mobile, windows stack vertically.

## Included panels

- Calendar: booking pages, availability, Google connection status, upcoming bookings, and calendar password.
- Community: Mimorigasaka invitations, membership, and moderation, subject to its existing owner role.
- Mimori: account, invitations, identity, and keyring. The account section opens when launched from this desktop.

These are the administrative surfaces found in this repository. Other independently hosted project dashboards are not registered here. Library import/review scripts and deployment tooling remain command-line tools.

## Access and embedding

The shell contains no private data. Each tool retains its own authentication and authorization. Calendar sessions are host-only, so an existing calendar-subdomain login does not automatically sign in on the main domain. Sign in there with the same calendar password. Community and Mimori continue to use their existing account flow.

Only the explicit panel routes with `?panel=1` allow same-origin framing. Other existing frame restrictions remain unchanged. The shell allows same-origin frames only and is itself not embeddable. Session/API CSRF checks are unchanged; no credentials are passed between windows or stored by the shell.

The registry is in `control/app.js`; new entries need a same-origin route and an explicit review of the embedding allowlist in `middleware/control-plane.mjs`.

## Verification

`npm test` covers the existing suite plus route redirects, framing restrictions, cache policy, and preserved authorization failures. Browser checks cover opening, closing, dock restore, maximize, and mobile stacking. No live booking or membership changes are required to verify the desktop.
