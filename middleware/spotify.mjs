import {getAnalysis} from './spotify-analysis.mjs';
// Same-origin Spotify metadata middleware. Never return OAuth credentials to visitors.
let token, expires = 0, cached, cacheUntil = 0, pending;
export async function nowPlaying(env, fetcher = fetch) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET || !env.SPOTIFY_REFRESH_TOKEN) {
    return {state: 'not connected'};
  }
  if (!token || Date.now() > expires) {
    const response = await fetcher('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {'Authorization': 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: env.SPOTIFY_REFRESH_TOKEN})
    });
    if (!response.ok) throw new Error('Spotify authorization unavailable');
    const data = await response.json();
    token = data.access_token;
    expires = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
  }
  const response = await fetcher('https://api.spotify.com/v1/me/player/currently-playing', {headers: {Authorization: 'Bearer ' + token}});
  if (response.status === 204) return {state: 'off air'};
  if (response.status === 401) { token = null; throw new Error('Spotify authorization unavailable'); }
  if (!response.ok) {
    if (response.status === 429) cacheUntil = Date.now() + Math.min(300, Math.max(15, Number(response.headers.get('Retry-After')) || 30)) * 1000;
    throw new Error('Spotify unavailable');
  }
  const data = await response.json(), item = data.item;
  if (!item || item.type !== 'track') return {state: 'off air'};
  return {id:item.id, sampledAt:Date.now(), isPlaying: data.is_playing, title: item.name, artist: item.artists.map(a => a.name).join(', '), album: item.album.name, art: item.album.images[0]?.url || '', url: item.external_urls.spotify, progressMs: data.progress_ms || 0, durationMs: item.duration_ms};
}
export async function spotifyMiddleware(request, env, next) {
    const url = new URL(request.url);
    const analysis = url.pathname === '/api/spotify/analysis';
    if (url.pathname !== '/api/spotify' && !analysis) return next();
    if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
    if (!cached || Date.now() >= cacheUntil) {
      if (!pending) pending = nowPlaying(env).then(data => { cached = data; cacheUntil = Date.now() + 10000; }).catch(() => { cached = {state: 'signal unavailable'}; cacheUntil = Math.max(cacheUntil, Date.now() + 15000); }).finally(() => { pending = null; });
      await pending;
    }
    if (analysis) {
      if (!cached?.id || !cached.isPlaying || url.searchParams.get('id') !== cached.id) return Response.json({state:'not current'}, {status:409});
      return Response.json(await getAnalysis(cached, env), {headers:{'Cache-Control':'no-store'}});
    }
    return Response.json(cached, {headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
}
