// Public release metadata only. Account credentials remain on our server.
const pending=new Map();
async function publicJSON(url){const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Release search unavailable');return response.json();}
export async function releaseHints(media,episode){
 const key=`ani.releases.v2:${media.id}:${episode}`;
 try{const hit=JSON.parse(localStorage.getItem(key));if(hit?.expires>Date.now())return hit.rows;}catch{}
 if(pending.has(key))return pending.get(key);
 const request=(async()=>{
   let rows=[];
   try{
     const map=await publicJSON(`https://api.ani.zip/mappings?anilist_id=${media.id}`);const kitsu=Number(map.mappings?.kitsu_id);
     if(Number(map.mappings?.anilist_id)===media.id&&Number.isSafeInteger(kitsu)&&kitsu>0){
       const data=await publicJSON(`https://torrentio.strem.fun/stream/${media.format==='MOVIE'?'movie':'series'}/kitsu:${kitsu}${media.format==='MOVIE'?'':':'+episode}.json`);
       rows=(data.streams||[]).filter(s=>/^[a-f0-9]{40}$/i.test(s.infoHash)&&typeof s.behaviorHints?.filename==='string').slice(0,20).map(s=>({hash:s.infoHash,title:String(s.title||'').slice(0,250),filename:s.behaviorHints.filename.slice(0,300)}));
     }
   }catch{}
   if(!rows.length){
     const data=await publicJSON(`https://aniraws.org/api/v1/feed?anilist_id=${media.id}&episode_number=${episode}&limit=50`);
     rows=(Array.isArray(data)?data:[]).filter(r=>Number(r.anilist_id)===media.id&&Number(r.episode_number)===episode&&/^[a-f0-9]{40}$/i.test(r.info_hash)).slice(0,20).map(r=>{const videos=(r.files||[]).filter(f=>/\.(mkv|mp4|m4v|webm)$/i.test(f.filename));return {hash:r.info_hash,title:String(r.title).slice(0,250),filename:videos.length===1?videos[0].filename.slice(0,300):'',audio:r.audio};});
   }
   // Keep requests within the existing API body limit, including long batch filenames.
   while(new TextEncoder().encode(JSON.stringify(rows)).length>8000)rows.pop();
   try{localStorage.setItem(key,JSON.stringify({rows,expires:Date.now()+21600000}));}catch{}return rows;
 })();pending.set(key,request);try{return await request;}finally{pending.delete(key);}
}
