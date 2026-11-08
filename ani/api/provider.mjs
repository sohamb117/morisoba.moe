export class ProviderError extends Error {
  constructor(message, code = 'unavailable') { super(message); this.code = code; }
}

export async function fetchText(url, options = {}, transport = fetch) {
  const response = await transport(url, { ...options, signal: AbortSignal.timeout(12000), redirect: 'manual' });
  if (!response.ok) {await response.body?.cancel();const error=new ProviderError(response.status===429?'Too many requests. Please try again shortly.':`Upstream returned ${response.status}`,response.status===429?'rate_limited':response.status===403?'blocked':'unavailable');error.source=new URL(url).hostname;throw error;}
  if (!response.body) throw new ProviderError('Empty upstream response');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try { for (;;) { const {value, done} = await reader.read(); if (done) break; size += value.length;
    if (size > 2_000_000) throw new ProviderError('Upstream response too large'); chunks.push(value); }
  } finally { await reader.cancel(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(data);
}
export async function fetchJSON(url, options = {}, transport = fetch) { try { return JSON.parse(await fetchText(url,options,transport)); } catch(error) { if(error instanceof SyntaxError)throw new ProviderError('Upstream did not return JSON'); throw error; } }

export function httpsURL(value) {
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (url.hostname === 'localhost' || /^[\d.:]+$/.test(url.hostname) || url.hostname.endsWith('.local')) return null;
    return url.href;
  } catch { return null; }
}

export function normalizeEpisodes(data, provider, mediaId) {
  if (!data || data.error || data.success === false) throw new ProviderError('Source could not resolve this title');
  const rows = []; const groups = data.episodes || data;
  for (const audio of ['sub', 'dub']) {
    const list = Array.isArray(groups) ? (audio === 'sub' ? groups : []) : groups[audio];
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      const number = Number(row.number ?? row.episode);
      if (!Number.isFinite(number) || number <= 0 || typeof row.id !== 'string') continue;
      rows.push({id: row.id, number, title: String(row.title || `Episode ${number}`), audio, provider, mediaId});
    }
  }
  return rows.sort((a,b) => a.number-b.number || a.audio.localeCompare(b.audio));
}

export function normalizeStreams(data, resolverOrigin) {
  if (!data || data.error || data.success === false) throw new ProviderError('Source could not resolve this episode');
  const root = data.data || data;
  const raw = root.streams || root.sources || (root.url ? [root] : []);
  const streams = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const url = httpsURL(item.url || item.file); if (!url) continue;
    const parsed = new URL(url);
    // Resolvers may hand back their own proxy. Never present it as direct playback.
    if (parsed.origin === resolverOrigin || /\/(?:proxy)(?:\/|$)/i.test(parsed.pathname) || parsed.searchParams.has('url')) continue;
    const declared = String(item.type || '').toLowerCase();
    const type = declared === 'embed' ? 'embed' : /m3u8|hls/.test(declared + parsed.pathname) ? 'hls' : /mp4|video/.test(declared + parsed.pathname) ? 'mp4' : null;
    if (!type) continue;
    streams.push({url, type, label: String(item.server || item.quality || type.toUpperCase()), referrer: httpsURL(item.headers?.Referer || item.headers?.referer),
      subtitles: (item.subtitles || root.subtitles || []).filter(t => httpsURL(t.url || t.file)).map(t => ({url: httpsURL(t.url || t.file), label: String(t.label || t.lang || 'Subtitles'), lang: String(t.lang || 'en')}))});
  }
  const embed = httpsURL(root.embed || root.embedUrl);
  if (embed && new URL(embed).origin !== resolverOrigin && !streams.some(s => s.url === embed)) streams.push({url: embed, type: 'embed', label: 'Provider player', referrer: null, subtitles: []});
  if (!streams.length) throw new ProviderError('No direct stream or provider embed was returned', 'no_direct_stream');
  return streams.sort((a,b) => Number(!!a.referrer)-Number(!!b.referrer));
}

// Every service is an instance of this class; extraction protocols are injected.
export class UniversalProvider {
  constructor(definition, adapter, transport = fetch) { this.definition = Object.freeze({...definition}); this.adapter = adapter; this.transport = transport; }
  get id() { return this.definition.id; }
  describe() { return {...this.definition, configured: !!this.adapter}; }
  async search(media) {
    const result = await this.episodes(media.id,media);
    return {...result, mediaId: media.id};
  }
  async episodes(mediaId, media) {
    if (!this.adapter) return {provider: this.id, status: 'not_configured', episodes: [], message: 'Resolver integration is not configured'};
    try { const data = await this.adapter.episodes(mediaId, this.transport, media);
      const episodes = normalizeEpisodes(data, this.id, mediaId);
      return {provider: this.id, status: episodes.length ? 'available' : 'not_found', episodes, checkedAt: new Date().toISOString()};
    } catch (error) { return {provider: this.id, status: error.code || 'unavailable', episodes: [], message: error instanceof ProviderError ? error.message : 'Source request failed', checkedAt: new Date().toISOString()}; }
  }
  async resolve(mediaId, episodeId, audio) {
    if (!this.adapter) throw new ProviderError('Resolver integration is not configured', 'not_configured');
    return normalizeStreams(await this.adapter.resolve(mediaId, episodeId, audio, this.transport), this.adapter.origin);
  }
}

export function resolverAdapter(base, key, protocol = 'anivexa') {
  const origin = new URL(base).origin; const root = base.replace(/\/$/, '');
  return {origin,
    async episodes(id, transport) {
      const data = await fetchJSON(`${root}/episodes/${protocol === 'anivexa' ? `${key}/` : ''}${id}`, {}, transport);
      if (protocol === 'miruro') return (data.data || data).providers?.[key] || data.providers?.[key] || data[key];
      return data[key] || data.providers?.[key];
    },
    async resolve(id, episodeId, audio, transport) {
      // Episode IDs are upstream data but must never become arbitrary request paths.
      const parts = episodeId.replace(/^\//, '').split('/');
      if (parts.length !== 5 || parts[0] !== 'watch' || parts[1] !== key || parts[2] !== String(id) || parts[3] !== audio || !/^[\w.:-]{1,250}$/.test(parts[4])) throw new ProviderError('Unexpected provider episode identifier');
      return fetchJSON(`${root}/${parts.map(encodeURIComponent).join('/')}`, {}, transport);
    }};
}

export const DEFINITIONS = [
  ['reanime','Re:Anime','https://reanime.to','reanime'],
  ['anikoto','Anikoto','https://anikototv.to','anikoto'],
  ['animepahe','animepahe','https://animepahe.pw','kiwi'],
  ['miruro','Miruro','https://www.miruro.cx','arc'],
  ['gotaku','Gotaku','https://gotaku.to','gotaku'],
  ['mkissa','MKissa','https://mkissa.to','mkissa'],
  ['anizone','AniZone','https://anizone.to','anizone'],
  ['kaa','KickAssAnime','https://kaa.lt','kaa'],
  ['senshi','Senshi','https://senshi.to','senshi'],
  ['animegg','AnimeGG','https://www.animegg.org','animegg'],
].map(([id,name,url,key]) => ({id,name,url,key}));

export function createProviders(env = {}, transport = fetch) {
  return DEFINITIONS.map(definition => {
    const miruro = ['animepahe','miruro'].includes(definition.id);
    const base = definition.id === 'gotaku' ? env.GOTAKU_RESOLVER_URL : miruro ? env.MIRURO_RESOLVER_URL : env.ANIVEXA_RESOLVER_URL;
    return new UniversalProvider(definition, definition.id === 'animegg' ? animeggAdapter() : base ? resolverAdapter(base, definition.key, miruro ? 'miruro' : 'anivexa') : null, transport);
  });
}

function plain(value) { return String(value).replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim(); }
const identity = value => plain(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function animeggAdapter() {
  const base='https://www.animegg.org';
  return {
    async episodes(id,transport,media) {
      if(!media?.title)throw new ProviderError('Title metadata is required');
      const page=await fetchText(`${base}/search/?q=${encodeURIComponent(media.alternateTitle || media.title)}`,{},transport);
      const names=[media.title,media.alternateTitle].filter(Boolean).map(identity);
      const candidates=[...page.matchAll(/<a\s+href="(\/series\/[a-z0-9-]+)"\s+class="mse">([\s\S]*?)<\/a>/gi)];
      const match=candidates.find(row=>names.includes(identity(row[2].match(/<h2>([\s\S]*?)<\/h2>/i)?.[1]||'')));
      if(!match)return {episodes:{sub:[],dub:[]}};
      const title=await fetchText(base+match[1],{},transport);const episodes={sub:[],dub:[]};
      for(const row of title.matchAll(/<div><a href="(\/[a-z0-9-]+-episode-([\d.]+))" class="anm_det_pop">([\s\S]*?)(?=<\/div>)/gi)) {
        for(const audio of ['sub','dub'])if(row[3].includes(audio==='sub'?'#subbed':'#dubbed'))episodes[audio].push({id:row[1].slice(1),number:Number(row[2]),title:plain(row[3].match(/<i class="anititle">([\s\S]*?)<\/i>/)?.[1]||`Episode ${row[2]}`)});
      }
      return {episodes};
    },
    async resolve(id,episode,audio,transport) {
      if(!/^[a-z0-9-]+-episode-\d+(?:\.\d+)?$/.test(episode))throw new ProviderError('Invalid episode');
      const html=await fetchText(`${base}/${episode}`,{},transport);
      const prefix=audio==='sub'?'subbed':'dubbed';
      const rows=[...html.matchAll(/<div id="(subbed|dubbed)-[^"]+" class="tab-pane">\s*<iframe src="(\/embed\/\d+)"/g)];
      const streams=[];
      for(const row of rows.filter(row=>row[1]===prefix)) {
        // Read only the player metadata. Never execute or embed its scripts/ads.
        const player=await fetchText(base+row[2],{},transport);
        const sources=player.match(/var\s+videoSources\s*=\s*(\[[^;]+\]);/)?.[1] || '';
        for(const source of sources.matchAll(/file:\s*"(\/play\/\d+\/video\.mp4\?[^"\s]+)"\s*,\s*label:\s*"([^"]+)"/g)) {
          const link=base+source[1].replace(/&amp;/g,'&');
          // Resolve only the redirect; never read or proxy the video body.
          const response=await transport(link,{method:'GET',redirect:'manual',headers:{Referer:base+row[2]},signal:AbortSignal.timeout(12000)});
          const target=httpsURL(response.headers.get('location'));await response.body?.cancel();
          if(response.status>=300&&response.status<400&&target)streams.push({url:target,type:'mp4',server:source[2]});
          else if(response.ok)streams.push({url:link,type:'mp4',server:source[2]});
        }
      }
      return {streams};
    }
  };
}
