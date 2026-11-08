import {cached} from './cache.mjs';
import {fetchJSON,fetchText,ProviderError} from './provider.mjs';
const normalized=s=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function seriesIdentity(media){
  const title=media.title;const season=Number(title.match(/(?:Season\s+(\d+)|(\d+)(?:st|nd|rd|th)\s+Season)/i)?.slice(1).find(Boolean)||1);
  return {title:title.replace(/\s*(?:Season\s+\d+|\d+(?:st|nd|rd|th)\s+Season)\s*/i,'').trim(),season};
}
export async function findCaptions(media,episode,transport=fetch){
  if(!Number.isInteger(episode)||episode<1||episode>2000)throw new ProviderError('Invalid episode','invalid_request');
  return cached(`captions:v2:${media.id}:${episode}`,21600,async()=>{
    try{
      const releases=await fetchJSON(`https://aniraws.org/api/v1/feed?anilist_id=${media.id}&episode_number=${episode}&limit=50`,{},transport);
      const embedded=(Array.isArray(releases)?releases:[]).filter(r=>Number(r.anilist_id)===media.id&&Number(r.episode_number)===episode).flatMap(r=>(r.files||[]).flatMap(f=>(f.subtitles||[]).filter(s=>/^https:\/\/aniraws\.org\/tasks\/\d+\/subtitles\/\d+$/.test(s.link)&&['ASS','SRT','VTT'].includes(s.format)&&/^[a-z]{3}$/i.test(s.language)).map(s=>({id:'ar-'+s.link.split('/').pop(),language:s.language.toLowerCase(),name:s.name+' / '+r.title,url:s.link}))));
      if(embedded.some(s=>s.language==='eng'&&!/signs|songs/i.test(s.name.split(' / ')[0])))return [...new Map(embedded.map(s=>[s.id,s])).values()].sort((a,b)=>Number(/signs|songs/i.test(a.name.split(' / ')[0]))-Number(/signs|songs/i.test(b.name.split(' / ')[0])));
    }catch{}
    const {title,season}=seriesIdentity(media);const kind=media.format==='MOVIE'?'movie':'series';
    const results=await cached(`imdb:${kind}:${title}`,2592000,()=>fetchJSON(`https://v3-cinemeta.strem.io/catalog/${kind}/top/search=${encodeURIComponent(title)}.json`,{},transport));
    const names=[title,media.alternateTitle].filter(Boolean).map(normalized);
    const matches=(results.metas||[]).filter(m=>/^tt\d+$/.test(m.id)&&names.includes(normalized(m.name)));
    const match=matches.sort((a,b)=>Math.abs(Number(a.releaseInfo?.slice(0,4))-media.year)-Math.abs(Number(b.releaseInfo?.slice(0,4))-media.year))[0];
    if(!match)return [];
    const data=await fetchJSON(`https://opensubtitles-v3.strem.io/subtitles/${kind}/${match.id}${kind==='series'?`:${season}:${episode}`:''}.json`,{},transport);
    return (data.subtitles||[]).filter(s=>/^\d+$/.test(s.id)&&/^https:\/\/subs\d+\.strem\.io\//.test(s.url)).map(s=>({id:s.id,language:s.lang,name:s.subtitleFileName||s.movieReleaseName||s.lang,url:s.url}));
  });
}
export async function captionText(media,episode,captionId,transport=fetch){
  const list=await findCaptions(media,episode,transport);const caption=list.find(c=>c.id===captionId);if(!caption)throw new ProviderError('Caption not found','invalid_request');
  return cached(`caption-file:${caption.id}`,2592000,async()=>{
    if(caption.id.startsWith('ar-')){
      const response=await transport(caption.url,{redirect:'manual',signal:AbortSignal.timeout(12000)});
      if(!response.ok){await response.body?.cancel();throw new ProviderError('Caption download failed');}
      const body=response.headers.get('Content-Type')?.includes('gzip')?response.body.pipeThrough(new DecompressionStream('gzip')):response.body;
      return fetchText(caption.url,{},async()=>new Response(body));
    }
    return fetchText(caption.url,{},transport);
  });
}
