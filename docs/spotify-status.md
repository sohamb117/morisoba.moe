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
