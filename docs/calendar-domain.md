# Calendar hosting: GitHub Pages

The calendar frontend is deployed by .github/workflows/deploy.yml from main, using scripts/build-calendar-pages.mjs. It publishes only the static calendar frontend. The root website remains served by the existing Cloudflare Worker.

## Custom domain

In this repository's Settings → Pages, set the custom domain to calendar.morisoba.moe. Then set this DNS record in Cloudflare:

| Type | Name | Target |
| --- | --- | --- |
| CNAME | calendar | sohamb117.github.io |

Remove the old ChatGPT-hosting CNAME and verification TXT records if you added them. The pending ChatGPT-hosting domain binding has been removed. Once the custom domain is configured, rerun the Pages workflow so its base path changes from /morisoba.moe to /.

Enable HTTPS in Pages once the certificate is ready. The portal requires HTTPS.

## Backend

GitHub Pages runs no server code. The frontend calls https://morisoba.moe/api/booking/ on the existing Cloudflare Worker, using an explicit origin allowlist, credentialed requests and CSRF tokens. Cookies remain Secure, HttpOnly and SameSite=Strict. Admin login requires the custom calendar.morisoba.moe domain so frontend and backend are same-site. The github.io address can display the frontend but is not an admin-login replacement.

The Worker needs migrations 0003–0005, an initial admin password hash and Google Calendar credentials. See booking.md. Without those, data requests fail closed. Existing data and your chosen password in the earlier private preview have not been deleted or migrated; that separate database must be migrated to the Worker before switching records over. No secrets or database export are included in the Pages artifact.

## Paths

- /admin/ — management UI; all data and mutations require a server session.
- /admin/login.html — password sign-in.
- /<booking_name> — guest page through Pages' custom 404 fallback. These render at the requested URL but the initial document response has status 404, a GitHub Pages limitation for runtime-created routes.

The UI shell is static and publicly downloadable; password verification, page settings and management operations remain protected by the API. The browser never receives the stored password hash.
