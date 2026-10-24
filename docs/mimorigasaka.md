# Mimorigasaka

`/mimorigasaka/` is an invite-only, multi-account feed in the existing morisoba Worker. The final design supersedes the initial public-read brief: every post, permalink API, and avatar requires a live session. HTML contains only the shell; the lock is never the authorization boundary. Members post as themselves and can edit/pin/delete their own posts. The owner can invite, revoke unused invites, disable members, and remove posts. There is no public signup or first-login administrator election.

## Run locally

Requires Node 22+.

```sh
npm ci
npm run setup:local
node scripts/mimori-owner-invite.mjs --local
npm run dev
```

Open the URL in `.wrangler/private/owner-invite-local.txt` to create the local owner account. The one-use token expires after 24 hours. Choose an ID (3–24 letters, numbers, underscores) and a passcode (12–128 characters). Local state persists in ignored `.wrangler/`. Do not use production credentials for local testing. Local cookies are enabled only by `MIMORI_LOCAL=true` on a loopback hostname; production uses `__Host-mimori`, Secure, HttpOnly, SameSite=Strict.

`npm test` runs the existing JavaScript suites and the API integration tests in real workerd with an isolated D1 database. `npm run check` checks script syntax. `npm run deploy:check` bundles the real Worker without publishing.

## Production provisioning

The existing Cloudflare account must be authenticated. Do not deploy with a temporary account or change the site's routes/domain.

1. `npx wrangler login` (or the account's normal scoped CI credentials).
2. `npx wrangler d1 create morisoba-mimorigasaka --binding MIMORI_DB --update-config`. This adds the real database ID to `wrangler.jsonc`; retain any existing bindings. If the database already exists, reuse its ID instead of creating a second one.
3. `npx wrangler d1 migrations apply MIMORI_DB --remote`.
4. `node scripts/mimori-owner-invite.mjs --remote`. This refuses to create a second owner or duplicate pending owner invitation. Only the token hash reaches D1/command arguments; the private invitation is written under ignored `.wrangler/private/` with mode 0600.
5. Review/commit the real D1 binding, then deploy through the existing Git/Cloudflare workflow or `npx wrangler deploy` after release approval. Keep `MIMORI_ORIGIN=https://morisoba.moe`, the existing Spotify variables/secrets/bindings, and Worker name `morisoba`. `keep_vars` preserves dashboard variables, but bindings should also be declared in config if managed by Wrangler.
6. Open the private owner invitation to set the owner's ID and passcode. Use `morisoba` for the requested `C:morisoba>` indicator. Set the display name, bio, and picture in Edit profile. No account or sample posts are precreated in production.
7. In Invitations & members, create member invitations. Links are shown once, expire in seven days, and each creates one member account. Share privately. Invite links use URL fragments, which the browser removes immediately; no invitation token appears in HTTP logs/referrers. All signed-in members see the shared feed; Mine filters the current author's posts. Additional logins require signing out with the separate Account → Sign out control.

Without a D1 binding or schema, the API fails closed with 503. This feature cannot run on static GitHub Pages alone. The Cloudflare domain must execute `worker.mjs`. Both `/mimorigasaka` and its assets/API routes are routed through the Worker for security headers. No embedded secrets or static post snapshots are shipped.

## Security and operational behavior

- Passwords: native `node:crypto` scrypt, N=16384/r=8/p=5 (OWASP's 16 MiB configuration), per-password random salt, constant-time comparison. Argon2 is not supported in Workers. Verify authentication CPU budget on the actual Workers plan; local workerd tests exercise the same cryptographic path, but are not a production load test.
- Sessions: random 256-bit cookie, only SHA-256 token hash in D1, seven-day fixed expiry, server-side revocation on logout, password change, and member disable. Password change creates a fresh session and revokes the previous ones. Session responses are never cached.
- Writes: strict same-origin checks, JSON content type, per-session CSRF header, and bound SQL parameters. Roles, author IDs, and upload ownership come from the session, never from client fields. Invitations are consumed in an atomic D1 batch with a unique constraint, including concurrent signup attempts.
- Throttling: D1-backed counters for source IP, account ID, mutations, pictures, passwords, and invitation creation. Expired sessions/counters are pruned on successful login. Configure an edge rate-limit rule for the auth endpoints if exposed to sustained abuse; application counters are not DDoS protection.
- Profiles: plain text only. Picture picker resizes/crops to 256px WebP before sending; server accepts only PNG/JPEG/WebP signatures up to 256 KB. SVG is rejected. D1 stores the small avatar blobs, avoiding a separate public bucket. Picture responses require authentication and are `no-store` with nosniff and a sandbox CSP.
- Feed: plain-text DOM rendering (no HTML/Markdown execution), only HTTP(S) linkification, newest-first ID cursor pagination, All/Pinned/Mine filters. Each post can be linked directly, including older posts outside the first page. Deleted posts are soft-deleted. Disabled authors' posts and pictures are hidden.
- Mobile: narrow single column; Identity stays collapsed until the top indicator is tapped. Desktop: 240px profile/composer beside a maximum 480px feed. The top indicator opens/focuses Identity; it never signs out. Mobile taps also collapse the panel. Account tools provide explicit logout.
- No browser-local session tokens or password storage, no service worker, no tracking integrations on the page. Tabs synchronize login changes and revalidate on return. Browser-held content cannot be retroactively erased from an already authorized reader.
- Recovery: keep Cloudflare/D1 account access secure. There is no email recovery service. An operator can replace a user's `password_hash` using the exported `hashPassword` helper and revoke their D1 sessions; never write plaintext passcodes to SQL or source control. Expired owner bootstrap invitations can be regenerated by the bootstrap script; revoke a lost unexpired invitation by its hash before replacing it.

References: [Cloudflare crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [D1 transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/).
