# Calendar on the existing Cloudflare Worker

Use the existing morisoba Worker, configured by wrangler.jsonc and worker.mjs. It serves both the existing website and the calendar; hostname routing selects the calendar at calendar.morisoba.moe.

Do not change this repository's GitHub Pages workflow, Pages custom domain or the root website's DNS records. There is no separate calendar Pages deployment.

## Attach the hostname

In Cloudflare: Workers & Pages → morisoba → Settings → Domains & Routes → Add → Custom Domain → calendar.morisoba.moe.

This adds only the calendar hostname to the existing Worker. Preserve every existing domain and route. Cloudflare manages the Worker's DNS target and TLS; do not point this hostname at github.io or chatgpt.site. Remove any obsolete calendar-only CNAME from earlier setup if it conflicts, leaving all other DNS records intact.

## Data and authentication

Apply migrations 0003–0005 to MIMORI_DB using Wrangler's existing migration tracking:

    npx wrangler d1 migrations list MIMORI_DB --remote
    npx wrangler d1 migrations apply MIMORI_DB --remote

The admin portal at /admin/ and guest pages at /<booking_name> use same-origin API requests and Secure, HttpOnly cookies. Named guest pages are served by the Worker with HTTP 200; no static 404 fallback is needed.

Before switching from the private preview, migrate its booking_types and booking_admin_credentials into the existing Worker database so saved pages and the user's chosen password are retained. Do not migrate browser sessions. Preserve any existing reservation records and locks. Keep password hashes and exports out of Git and public assets.

The initial password can instead be configured with BOOKING_ADMIN_PASSWORD_HASH when no saved credential exists. Google Calendar credentials listed in booking.md are required before accepting bookings. The admin portal can manage pages before the calendar connection is configured.

## Verification

Check the original website, HTTPS on calendar.morisoba.moe, password sign-in/change/sign-out, a named booking page, and a test invitation/cancellation. Cloudflare account access is required to complete the hostname and database setup; a successful source push does not prove those steps completed.
