import {cached,cacheValue,readCached} from './cache.mjs';
import {kitsuCatalog,malCatalog,offlineCatalog,catalogSource} from './catalog-fallbacks.mjs';
import {createProviders, fetchJSON, ProviderError} from './provider.mjs';
import {handleDebrid} from './real-debrid.mjs';


const fields = 'id idMal title { english romaji native } coverImage { large } format episodes status synonyms nextAiringEpisode { episode airingAt } averageScore seasonYear description(asHtml:false)';
async function fetchCatalog(query, id, transport = fetch) {
  const gql = id ? `query($id:Int!){Media(id:$id,type:ANIME){${fields}}}` : `query($search:String){Page(perPage:24){media(type:ANIME,search:$search,sort:${query ? 'SEARCH_MATCH' : 'TRENDING_DESC'}){${fields}}}}`;
  const data = await fetchJSON('https://graphql.anilist.co', {method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','User-Agent':'morisoba-ani/1.0 (+https://ani.morisoba.moe)'},body:JSON.stringify({query:gql,variables:id?{id}:{search:query || null}})}, transport);
  if (data.errors || !data.data) throw new ProviderError('Catalogue is temporarily unavailable');
  const rows = id ? [data.data.Media] : data.data.Page.media;
  return rows.filter(Boolean).map(m => ({id:m.id,malId:m.idMal,title:m.title.english || m.title.romaji || m.title.native,alternateTitle:m.title.romaji,poster:m.coverImage?.large,format:m.format,episodes:m.status==='NOT_YET_RELEASED'?0:m.nextAiringEpisode?Math.max(0,m.nextAiringEpisode.episode-1):m.episodes,totalEpisodes:m.episodes,status:m.status,synonyms:m.synonyms||[],score:m.averageScore,year:m.seasonYear,description:(m.description || '').replace(/<[^>]+>/g,'')}));
}

async function available(source,load){
 if(await readCached('catalog-down:v4:'+source))throw new ProviderError('Catalogue temporarily unavailable');
 try{return await load();}catch(error){console.error('Catalogue source failed',source,error.code||error.name,error.message);await cacheValue('catalog-down:v4:'+source,true,300);throw error;}
}
export async function catalog(query,id,transport=fetch){
 return cached(id?`title:v2:${id}`:`search:v3:${query||''}`,id?86400:21600,async()=>{
  if(id){const source=catalogSource(id);if(source==='anidb')return offlineCatalog(null,id);if(source==='kitsu')return kitsuCatalog(null,id,transport);if(source==='mal')return malCatalog(null,id,transport);try{return await fetchCatalog(null,id,transport);}catch(error){const saved=offlineCatalog(null,id);if(saved.length)return saved;throw error;}}
  let empty=[];
  for(const [source,loader] of [['anilist',fetchCatalog],['kitsu',kitsuCatalog],['mal',malCatalog]]){
   try{const rows=await available(source,()=>loader(query,null,transport));if(rows.length){await Promise.all(rows.map(row=>cacheValue('title:v2:'+row.id,[row],86400)));return rows;}empty=rows;}catch{}
  }
  const rows=offlineCatalog(query);return rows.length?rows:empty;
 });
}

const json = (value,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleAPI(request, env = {}, transport = fetch, context = {}) {
  const url = new URL(request.url); const path = url.pathname;
  if (!path.startsWith('/api/')) return null;
  if (path.startsWith('/api/debrid/')) return handleDebrid(request,env,transport,{...context,catalog});
  if (request.method !== 'GET') return json({error:'Method not allowed'},405);
  const providers = createProviders(env,transport);
  try {
    if (path === '/api/providers') return json({providers:providers.map(p=>p.describe()),mediaProxy:false});
    if (path === '/api/search') {
      const q=(url.searchParams.get('q') || '').trim(); if(q.length>120) return json({error:'Search is too long'},400);
      return json({results:await catalog(q,null,transport)});
    }
    const match = path.match(/^\/api\/titles\/([1-9]\d{0,8})(?:\/(sources|resolve))?$/);
    if (!match) return json({error:'Not found'},404);
    const id=Number(match[1]);
    if(!match[2]) { const [title]=await catalog(null,id,transport); return title?json(title):json({error:'Title not found'},404); }
    if(match[2]==='sources') {
      const selected=url.searchParams.get('provider'); const list=selected?providers.filter(p=>p.id===selected):providers;
      if(!list.length)return json({error:'Unknown provider'},400);
      const [media]=await catalog(null,id,transport); if(!media)return json({error:'Title not found'},404);
      return json({mediaId:id,sources:await Promise.all(list.map(p=>p.search(media)))});
    }
    const provider=providers.find(p=>p.id===url.searchParams.get('provider')); const episode=url.searchParams.get('episode'); const audio=url.searchParams.get('audio') || 'sub';
    if(!provider || !episode || episode.length>400 || !['sub','dub'].includes(audio))return json({error:'Invalid episode or provider'},400);
    return json({provider:provider.id,streams:await provider.resolve(id,episode,audio),mediaProxy:false});
  } catch(error) { if(path==='/api/search')console.error('Catalogue failure',error.name,String(error.message).slice(0,300));return json({error:error instanceof ProviderError?error.message:'Service temporarily unavailable',code:error.code || 'unavailable'},502); }
}
