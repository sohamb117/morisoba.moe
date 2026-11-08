# ani.morisoba.moe

Single-page player using Morisoba typography and artwork. TorBox is the default when `TORBOX_TOKEN` is configured. Real-Debrid remains a legacy configuration fallback only when that token is absent.

## Catalogue and playback

The browser queries the public AniList API directly, retaining AniList IDs, names, artwork, release status, and aired episode counts. This avoids AniList's rejection of Cloudflare egress. Catalogue metadata is cached in the browser for six hours; authenticated metadata sent to the server is scoped to the viewer. Unreleased shows do not trigger torrent searches or fabricate episodes. Missing aired episode counts use dated episode mappings.

Release discovery first checks the existing account library. Exact AniList-to-Kitsu mappings can query Torrentio; recent titles without those mappings use AniRaws' direct AniList-ID and episode filters. These are public metadata requests: neither receives the TorBox key. Nyaa RSS remains a sequential, cached fallback with cooldown handling, rather than a burst of parallel synonym searches. Browser-side public release discovery can recover from server-IP rate limits. Release hints contain bounded hashes and filenames, never arbitrary media URLs.

The server checks TorBox cache availability, selects the exact episode file and requested audio, and privately fetches and validates TorBox's HLS playlist. Relative media references become absolute TorBox CDN URLs. Key-bearing references, foreign hosts, and nested playlists fail closed. Video segments travel directly from TorBox to the browser; account keys never enter browser assets or playback responses. Only already-cached torrents are added, with seeding disabled. No extra server or paid provider is required.

Public metadata uses memory and existing persistent KV with coalescing and stale-on-error fallback. Release searches cache for six hours; mappings for one day. Private playlists stay in memory for 60 seconds. Rate-limit recovery is bounded. A player that cannot load initial video within 20 seconds tries another cached release. Failed hashes are excluded; recovery after playback begins retains position and playing state.

Audio and captions share one popup. Exact AniList episode captions (including compressed ASS tracks) are preferred, with external subtitle search as fallback. Captions support language/track selection, timing offset, size, vertical position, and alignment. Sources contains the alternate-release action. Website-provider adapters remain registered but are not the default playback path.

## Accounts

The Morisoba control panel includes Anime Accounts. Owners can create members, disable or re-enable them, and reset passwords. Password changes and disabling revoke member sessions. Anime members cannot access the owner control panel. Production uses existing owner authentication, D1 sessions, same-origin mutations, and Worker secrets. The account schema is in `migrations/0015_ani_accounts.sql`.

## Development and deployment

Run `node server.mjs` from this directory with Node 22+. Credentials belong in ignored `.dev.vars` with owner-only permissions. The local connection helper is not shipped in production assets. Run `node --test test/*.test.mjs`; runtime tests require permission to open a local test listener.

Deploy from the repository root using the installed Wrangler with `--config ani/wrangler.jsonc --secrets-file ani/.dev.vars`. The root site's `.assetsignore` excludes `/ani/**` so it cannot accidentally publish backend files or local credentials. Root admin assets use the existing protocol build/deploy workflow.

## Verification

46 anime checks cover authorization, viewer metadata isolation, exact episode/file selection, retries excluding failed hashes, new-series ID discovery, caches, private playlists, and real workerd fetch behavior. Separate account/control tests cover member privileges and session revocation.

Production browser tests include Black Clover, Black Clover Season 2, Spy x Family Season 3, Overgeared, Devils' Crest, Blue Box Season 2, The Apothecary Diaries Season 3, Firefly Wedding, Space Mercenary, and Dragon Ball Super: Beerus. Testing uses five concurrent browser players and checks decoded dimensions, advancing playback clocks, and errors. A playlist response alone is not counted as successful playback. Upstream cache availability and CDN outages remain external dependencies; the app cannot promise every episode is cached.
