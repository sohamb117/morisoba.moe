// Analysis is requested only by visible visitors, and only for the current song.
const memory = new Map(), inflight = new Map();
const DAY = 86400;
function clamp(value, low, high, fallback) {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
}
export function normalizeFeatures(raw = {}) {
  const unit = value => Number.isFinite(value) ? clamp(value > 1 ? value / 100 : value, 0, 1, .5) : null;
  return {
    tempo: clamp(raw.tempo ?? raw.bpm, 30, 300, null),
    energy: unit(raw.energy), danceability: unit(raw.danceability),
    acousticness: unit(raw.acousticness), instrumentalness: unit(raw.instrumentalness)
  };
}
export function normalizeGrid(raw, durationMs) {
  const limit = durationMs / 1000 + 1;
  const clean = values => Array.isArray(values) ? [...new Set(values.filter(x => Number.isFinite(x) && x >= 0 && x <= limit))].sort((a,b) => a-b).slice(0,12000) : [];
  const beats = clean(raw.beats), downbeats = clean(raw.downbeats);
  if (beats.length < 3) return null;
  return {beats, downbeats, tempo: clamp(raw.tempo, 30, 300, null)};
}
async function json(url, fetcher, headers = {}) {
  const response = await fetcher(url, {headers, signal: AbortSignal.timeout(4500)});
  if (!response.ok) throw new Error('Analysis unavailable');
  return response.json();
}
async function recco(track, fetcher) {
  const result = await json('https://api.reccobeats.com/v1/track?ids=' + encodeURIComponent(track.id), fetcher);
  const match = result.content?.find(item => item.href === 'https://open.spotify.com/track/' + track.id);
  if (!match || !/^[a-f0-9-]{36}$/i.test(match.id)) return null;
  return normalizeFeatures(await json('https://api.reccobeats.com/v1/track/' + match.id + '/audio-features', fetcher));
}
export async function getAnalysis(track, env, fetcher = fetch) {
  const durable = env.SPOTIFY_ANALYSIS;
  // Require durable cache before making metered Brizm calls.
  const brizm = !!(env.BRIZM_API_KEY && durable);
  const key = 'analysis:v1:' + (brizm ? 'brizm:' : 'fallback:') + track.id;
  const hit = memory.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const task = (async () => {
    let kvAvailable = false;
    if (durable) {
      try {
        const cached = await durable.get(key, 'json');
        kvAvailable = true;
        if (cached?.version === 1 && cached.trackId === track.id) {
          remember(key, cached, 3600); return cached;
        }
      } catch (_) { /* Never spend Brizm quota when durable cache cannot be read. */ }
    }
    let grid = null, features = null, source = 'default';
    if (brizm && kvAvailable) {
      try {
        const raw = await json('https://api.brizm.dev/v1/beatgrid/' + encodeURIComponent(track.id), fetcher, {Authorization:'Bearer ' + env.BRIZM_API_KEY});
        grid = normalizeGrid(raw, track.durationMs);
        if (grid) { features = normalizeFeatures(raw); source = 'brizm'; }
      } catch (_) { /* A failed provider must never break current playback. */ }
    }
    if (!grid) {
      try { features = await recco(track, fetcher); if (features) source = 'reccobeats'; } catch (_) {}
    }
    const value = {version:1, trackId:track.id, mode:grid ? 'beatgrid' : features?.tempo ? 'tempo' : 'ambient', source,
      features:features || normalizeFeatures(), beats:grid?.beats || [], downbeats:grid?.downbeats || []};
    // Retry unavailable providers later, not on each Spotify poll or visitor.
    const ttl = grid ? 180 * DAY : source === 'reccobeats' ? DAY : 3600;
    remember(key, value, ttl);
    if (kvAvailable) { try { await durable.put(key, JSON.stringify(value), {expirationTtl:ttl}); } catch (_) {} }
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
function remember(key, value, seconds) {
  if (memory.size >= 64) memory.delete(memory.keys().next().value);
  memory.set(key, {value, until:Date.now() + seconds * 1000});
}
