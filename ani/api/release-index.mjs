import {cached} from './cache.mjs';
import {fetchJSON,ProviderError} from './provider.mjs';

export async function episodeMapping(media,transport=fetch){
  return cached(`episode-map:v1:${media.id}`,86400,async()=>{
    const data=await fetchJSON(`https://api.ani.zip/mappings?anilist_id=${media.id}`,{},transport);
    if(Number(data.mappings?.anilist_id)!==media.id)throw new ProviderError('Episode mapping does not match AniList','no_match');
    return data;
  });
}
export async function indexedReleases(media,episode,transport=fetch){
  return cached(`release-index:v2:${media.id}:${episode}`,21600,async()=>{
    let primaryError;
    try{
      const map=await episodeMapping(media,transport);const kitsu=Number(map.mappings?.kitsu_id);
      if(Number.isSafeInteger(kitsu)&&kitsu>0){
        const data=await fetchJSON(`https://torrentio.strem.fun/stream/${media.format==='MOVIE'?'movie':'series'}/kitsu:${kitsu}${media.format==='MOVIE'?'':':'+episode}.json`,{},transport);
        const rows=(data.streams||[]).filter(s=>/^[a-f0-9]{40}$/i.test(s.infoHash)).map(s=>({hash:s.infoHash.toLowerCase(),title:String(s.title||''),filename:s.behaviorHints?.filename,seeders:Number(String(s.title).match(/👤\s*(\d+)/)?.[1])||0,episodes:[episode]}));
        if(rows.length)return rows;
      }
    }catch(error){primaryError=error;}
    // New series may not have cross-service mappings yet. This feed keys releases
    // directly by AniList ID and parsed episode number, without fuzzy title matching.
    const data=await fetchJSON(`https://aniraws.org/api/v1/feed?anilist_id=${media.id}&episode_number=${episode}&limit=50`,{},transport);
    if(!Array.isArray(data))throw primaryError||new ProviderError('Invalid release index response');
    return data.filter(r=>Number(r.anilist_id)===media.id&&Number(r.episode_number)===episode&&/^[a-f0-9]{40}$/i.test(r.info_hash)).map(r=>{
      const videos=(r.files||[]).filter(f=>/\.(mkv|mp4|m4v|webm)$/i.test(f.filename));
      return {hash:r.info_hash.toLowerCase(),title:r.title,filename:videos.length===1?videos[0].filename:undefined,seeders:Number(r.seeders)||0,audio:r.audio,episodes:[episode]};
    });
  });
}
export async function mappedEpisodes(media,transport=fetch){
  if(media.status==='NOT_YET_RELEASED'||media.episodes===0)return [];
  const map=await episodeMapping(media,transport);
  return Object.entries(map.episodes||{}).filter(([number,e])=>/^\d+$/.test(number)&&+number>0&&+number<=2000&&e.airDateUtc&&Date.parse(e.airDateUtc)<=Date.now()).map(([number])=>+number).sort((a,b)=>a-b);
}
