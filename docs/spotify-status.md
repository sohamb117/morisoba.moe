# Spotify status

The status window opens by default and polls `/api/spotify` every 15 seconds while the page is visible. It shows the owner's current song, artist, album, original cover art, Spotify link, and interpolated track progress. Paused playback freezes the progress and flattens the waveform. No playback shows an off-air state; failed requests clear stale tracks. Reduced-motion uses a flat waveform.

The waveform is a decorative playback animation, not an audio spectrum. Spotify's currently-playing API provides metadata and position, not the remote device's audio samples.

## One-time owner setup

The site keeps its existing Cloudflare Worker identity (`morisoba`). `worker.mjs` composes the Spotify middleware with the existing static ASSETS handler. Only `/api/spotify` runs middleware first; all other paths keep normal asset serving. There is no separate backend service. No visitor logs in, and no secret goes into the static website.

1. Create an app in https://developer.spotify.com/dashboard and register an exact callback URI you control. Authorize **your** account using Spotify's Authorization Code flow with only `user-read-currently-playing`. Exchange the returned code server-side for a refresh token. Official guide: https://developer.spotify.com/documentation/web-api/tutorials/code-flow
2. From the repository root, use `npx wrangler secret put` separately for `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REFRESH_TOKEN`. Enter values at the hidden prompts; never commit them. Keep tokens out of terminal arguments and logs.
3. Deploy the existing site with `npx wrangler deploy` or its existing Cloudflare Git build integration. `wrangler.jsonc` retains the existing `morisoba` Worker name and asset directory. Confirm it is connected to the existing domain.
4. Publish the website branch through the normal repository workflow. Verify `/api/spotify` and the status panel while playing, paused, and stopped on the owner's Spotify account.

If Spotify authorization expires or is revoked, repeat authorization and replace the refresh-token secret. No recent listening history is exposed when playback is absent. All public visitors see the owner's song; use Spotify's private-session controls when needed.

## Checks

`node --test tests/spotify-status.test.mjs`

Live Spotify and Cloudflare verification requires the owner connection above.

## Beat-grid visualizer and cache setup

The frontend requests analysis only for the current song while the page and status panel are visible. No scheduled jobs run. The browser retains up to 20 song analyses in memory. The middleware validates that the requested song is the current playing track; arbitrary song IDs cannot consume the Brizm allowance.

Analysis priority:

1. Shared Cloudflare KV cache (`SPOTIFY_ANALYSIS` binding).
2. Brizm `GET /v1/beatgrid/{spotify_id}` using server-side `BRIZM_API_KEY`. Actual beat/downbeat timestamps drive a synthesized waveform; this is not a sampled amplitude waveform.
3. ReccoBeats track lookup and audio features (no key): actual tempo, energy, acousticness and danceability select a rhythmic, acoustic, intense or soft simulation. These are visual styles, not asserted musical genres.
4. A labeled ambient fallback when no data is available. Its default pulse is not claimed to be measured song BPM.

In Cloudflare:

- Storage & Databases → KV → Create namespace → name `morisoba-spotify-analysis`.
- Workers & Pages → morisoba → Bindings → Add → KV namespace → variable name `SPOTIFY_ANALYSIS` → select that namespace.
- Settings → Variables and Secrets → Add Secret `BRIZM_API_KEY` with the **live** key supplied by Brizm. A test key returns mock data and must not be used for the public visualizer.
- Deploy/apply the updated bindings and secrets. If Git deploys are managed with Wrangler, add the actual namespace ID to `kv_namespaces` in wrangler.jsonc after creating it; never use a placeholder ID. The binding is deliberately optional so an unconfigured namespace does not break existing deployment.

Request Brizm API access via https://developers.brizm.dev/docs/quickstart/. Their documented schema has beat timestamps, but live responses and catalog coverage remain unverified until a key is configured.

Brizm is called only when its key **and a readable durable cache** are configured. Grids are stored for 180 days, tempo fallback for 24 hours, total provider failures for an hour. Changing from fallback-only to configured Brizm changes the cache key immediately. An in-memory cache and same-isolate promise sharing reduce duplicate requests; KV is eventually consistent, so concurrent first requests in different isolates/regions can still duplicate a call. This is not an exact global quota limiter.

`node --test tests/spotify-status.test.mjs tests/spotify-analysis.test.mjs`
