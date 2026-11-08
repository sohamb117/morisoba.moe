import {indexedReleases,mappedEpisodes} from './release-index.mjs';
import {TorBoxClient} from './torbox.mjs';
import {defaultAudio} from './media-header.mjs';
import {cached,cacheValue,readCached} from './cache.mjs';
import {UniversalProvider,fetchText,ProviderError} from './provider.mjs';
import {RealDebridClient} from './real-debrid.mjs';

const indexCache=new Map(),jobs=new Map(),inflight=new Map();
const plain=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const identity=s=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function parseReleases(xml,media){
  const names=[media.title,media.alternateTitle,...(media.synonyms||[])].filter(Boolean).map(identity);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([,row])=>{
    const field=name=>plain(row.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1]||'');
    return {title:field('title'),hash:field('nyaa:infoHash'),seeders:Number(field('nyaa:seeders'))||0};
  }).filter(r=>/^[a-f0-9]{40}$/i.test(r.hash)&&names.some(n=>(' '+identity(r.title)+' ').includes(' '+n+' '))&&!/\b(ISO|BDMV|remux|soundtrack|live action)\b/i.test(r.title)&&!(media.format!=='MOVIE'&&/\b(movie|extras|specials)\b/i.test(r.title)&&!/(?:complete|batch|series|01\s*[-~]|s0?1|\+)/i.test(r.title)));
}
export function releaseEpisodes(release,media){
  const clean=release.title.replace(/\[[^\]]*\]/g,' ').replace(/\([^)]*(?:720|1080|2160|480)p[^)]*\)/gi,' ');
  const range=clean.match(/\b(\d{1,3})\s*[-~]\s*(\d{1,3})\b/);
  if(range&&+range[1]>0&&+range[2]>=+range[1]&&+range[2]<=Math.min(media.episodes||2000,2000))return Array.from({length:+range[2]-+range[1]+1},(_,i)=>+range[1]+i);
  const single=clean.match(/\bS\d{1,2}E(\d{1,3})\b/i)||clean.match(/\s-\s(\d{1,3})(?:v\d)?\b/);
  if(single)return [+single[1]];
  if(media.format==='MOVIE')return [1];
  // A batch/season release, or a bare series name followed by encoding details.
  const remainder=identity(clean).replace(identity(media.title),'').replace(identity(media.alternateTitle||media.title),'').trim();
  if(/\b(batch|complete|season|s0?1)\b/i.test(clean)||!remainder||/^(?:v\d+\s*)?$/.test(remainder))return Array.from({length:Math.min(media.episodes||0,2000)},(_,i)=>i+1);
  return [];
}
export function chooseFile(files,number,media){
  const videos=(files||[]).filter(f=>/\.(mp4|m4v|webm|mkv)$/i.test(f.path)&&!/(?:^|[\W_])(sample|bonus|ncop|nced|opening|ending|trailer|special|ova|movie|s00e\d+)(?:[\W_]|$)/i.test(f.path));
  const matches=videos.filter(f=>{const name=f.path.split('/').pop().replace(/_/g,' ').replace(/\[[^\]]*\]/g,' ').replace(/\.(mp4|m4v|webm|mkv)$/i,'');const m=name.match(/\bS\d{1,2}E(\d{1,3})\b/i)||name.match(/(?:\s-\s|\b(?:EP?|Episode)\s*)(\d{1,3})(?:v\d)?\b/i)||name.match(/(?:^|\s)(\d{1,3})(?:v\d)?(?:\s|$)/);return m&&+m[1]===number;});
  if(matches.length===1)return matches[0];
  if(media.format==='MOVIE'&&videos.length===1&&number===1)return videos[0];
  throw new ProviderError('Could not identify this episode in the release','no_match');
}
function supportsAudio(r,audio){if(Array.isArray(r.audio)&&r.audio.length)return r.audio.some(l=>(audio==='dub'?['en','eng']:['ja','jpn']).includes(String(l).toLowerCase()));const dub=/\b(dual|multi.audio|eng(?:lish)? dub|dubbed)\b/i.test(r.title);return audio==='dub'?dub:!(/\beng(?:lish)? dub/i.test(r.title)&&! /dual/i.test(r.title));}
function score(r){return (r.seeders>0?200:0)+Math.min(r.seeders,200)+(/1080p/i.test(r.title)?100:0)-(/2160p|4K/i.test(r.title)?300:0)+(/Erai-raws|SubsPlease/i.test(r.title)?200:0)+(/\bmp4\b/i.test(r.title)?100:0)+(/\bAAC\b/i.test(r.title)?50:0)-(/\b(AV1|HEVC|x265|Hi10p|10bit|10.bit|AC3)\b/i.test(r.title)?200:0);}
export async function releases(media,transport,episode){
  // Exact catalogue-ID/episode matches avoid season-name and batch-number ambiguity.
  if(episode){try{const rows=await indexedReleases(media,episode,transport);if(rows.length)return rows;}catch(error){console.error("Release lookup failed",media.id,error.code||error.name,error.source||"",error.message);}}
  const queries=[...new Set([media.alternateTitle,media.title].filter(Boolean))];
  const rows=[];let failure;
  for(const q of queries){
    try{const found=await cached(`nyaa:v3:${q}`,21600,async()=>{
      if(await readCached('nyaa:cooldown'))throw new ProviderError('Release index is cooling down','rate_limited');
      try{return parseReleases(await fetchText('https://nyaa.si/?page=rss&c=1_2&f=0&q='+encodeURIComponent(q),{},transport),media);}
      catch(error){if(error.code==='rate_limited')await cacheValue('nyaa:cooldown',true,120);throw error;}
    });rows.push(...found);if(found.length)break;}catch(error){failure=error;}
  }
  if(!rows.length&&failure)throw failure;
  return [...new Map(rows.map(r=>[r.hash,r])).values()].map(r=>({...r,episodes:releaseEpisodes(r,media)})).filter(r=>r.episodes.length).sort((a,b)=>score(b)-score(a));
}

export function torrentProvider(transport=fetch){return new UniversalProvider({id:'library',name:'Library'}, {async episodes(id,t,media){
  let numbers;
  if(media.status==='NOT_YET_RELEASED'||media.episodes===0)numbers=[];
  else if(media.episodes)numbers=Array.from({length:Math.min(media.episodes,2000)},(_,i)=>i+1);
  else numbers=await mappedEpisodes(media,t);
  const rows=numbers.map(number=>({id:String(number),number}));return {episodes:{sub:rows,dub:rows}};
}},transport);}
function candidateFile(files,number,media,candidate){
  if(candidate.filename){const matches=files.filter(f=>f.path?.split('/').pop()===candidate.filename&&/\.(mp4|m4v|webm|mkv)$/i.test(f.path));if(matches.length===1)return matches[0];}
  return chooseFile(files,number,media);
}

export async function resolveTorrent(media,number,audio,env,transport=fetch,retry=false,hints=[]){
  if(!Number.isInteger(number)||number<1||number>2000||!['sub','dub'].includes(audio))throw new ProviderError('Invalid episode','invalid_request');
  const backend=env.TORBOX_TOKEN?'torbox':'realdebrid';const key=`${backend}:${media.id}:${number}:${audio}`;
  if(inflight.has(key))return inflight.get(key);
  const run=(async()=>{
    const client=env.TORBOX_TOKEN?new TorBoxClient(env.TORBOX_TOKEN,transport):new RealDebridClient(env.REAL_DEBRID_TOKEN,transport);
    let job=jobs.get(key);if(job&&job.expires<Date.now()){jobs.delete(key);job=null;}
    if(job?.ready&&!retry)return job.ready;
    const rejectedHashes=job?.rejectedHashes||new Set();
    if(retry&&job?.activeHash){rejectedHashes.add(job.activeHash);job.ready=null;job.pending=[];job.active=null;job.activeHash=null;}
    if(retry||hints.length&&job&&!job.pending.length){job=null;}
    if(!job){
      const existing=await client.request('torrents?limit=100');
      const names=[media.title,media.alternateTitle,...(media.synonyms||[])].filter(Boolean).map(identity);
      const library=existing.filter(t=>names.some(n=>(' '+identity(t.filename||'')+' ').includes(' '+n+' '))).map(t=>({hash:t.hash,title:t.filename,seeders:1,episodes:releaseEpisodes({title:t.filename},media)}));
      let candidates=library.filter(r=>r.episodes.includes(number));
      candidates=[...new Map([...candidates,...hints].map(r=>[r.hash,r])).values()];
      if(!candidates.some(r=>supportsAudio(r,audio))||retry&&!hints.length){try{const indexed=await releases(media,transport,number);candidates=[...new Map([...candidates,...indexed].map(r=>[r.hash,r])).values()];}catch(error){if(!candidates.length)throw error;}}

      const available=candidates.filter(r=>r.episodes.includes(number)&&supportsAudio(r,audio)&&!rejectedHashes.has(r.hash));
      const hashes=client.cached?await client.cached(available.map(r=>r.hash)):new Set(existing.filter(t=>t.status==='downloaded').map(t=>t.hash));
      const ranked=available.filter(r=>backend!=='torbox'||hashes.has(r.hash)).sort((a,b)=>1000*(Number(hashes.has(b.hash))-Number(hashes.has(a.hash)))+score(b)-score(a));
      job={candidates:ranked,existing,attempt:0,pending:[],blocked:0,rejected:new Set(),rejectedHashes,expires:Date.now()+3600000};
      if(jobs.size>200)jobs.delete(jobs.keys().next().value);jobs.set(key,job);
    }
    if(retry&&job.active){job.rejected.add(job.active);job.ready=null;job.pending=job.pending.filter(p=>p.id!==job.active);job.active=null;}
    for(const pending of job.pending){
      try{const result=await client.resolve(pending.id,pending.fileId,audio);pending.progress=result.progress||0;
        if(result.status==='ready'){await checkAudio(result,audio,transport);job.active=pending.id;job.activeHash=pending.hash;job.ready=result;return result;}
      }catch(error){if(['authentication_required','rate_limited','account_limit','playback_privacy_required'].includes(error.code))throw error;job.rejected.add(pending.id);}
    }
    job.pending=job.pending.filter(p=>!job.rejected.has(p.id));
    // Try another release when the current ones are not ready; never pin the viewer to a stalled download.
    for(let count=0;count<2&&job.attempt<Math.min(job.candidates.length,10);count++){
      const candidate=job.candidates[job.attempt++];if(await readCached(backend+'-blocked:'+candidate.hash)){job.blocked++;continue;}let torrent,file;
      try{
        for(const row of job.existing.filter(t=>t.hash===candidate.hash&&!job.rejected.has(t.id))){const t=await client.torrent(row.id);try{const f=candidateFile(t.files,number,media,candidate);if(f.selected===1||t.status==='waiting_files_selection'){torrent=t;file=f;break;}}catch{}}
        if(!torrent){const added=await client.addMagnet('magnet:?xt=urn:btih:'+candidate.hash);torrent=await client.torrent(added.id);}
        if(torrent.status==='magnet_conversion')continue;
        file ||= candidateFile(torrent.files,number,media,candidate);
        if(torrent.status==='waiting_files_selection')await client.select(torrent.id,file.id);
        const result=await client.resolve(torrent.id,file.id,audio);
        const pending={id:torrent.id,hash:candidate.hash,fileId:file.id,progress:result.progress||0};job.pending.push(pending);
        if(result.status==='ready'){await checkAudio(result,audio,transport);job.active=torrent.id;job.activeHash=candidate.hash;job.ready=result;return result;}
      }catch(error){if(error.code==='blocked_release'){job.blocked++;await cacheValue(backend+'-blocked:'+candidate.hash,true,86400);}if(['authentication_required','rate_limited','account_limit','playback_privacy_required'].includes(error.code))throw error;}
    }
    if(job.pending.length)return {status:'preparing',progress:Math.max(...job.pending.map(p=>p.progress)),streams:[],searching:job.attempt<Math.min(job.candidates.length,10)};
    if(job.attempt<job.candidates.length&&job.attempt<10)return {status:'searching',streams:[]};
    throw new ProviderError(job.blocked?'The streaming service rejected the available releases.':'No matching release is available yet.',job.blocked?'blocked_release':'unavailable');
  })();inflight.set(key,run);try{return await run;}finally{inflight.delete(key);}
}

async function checkAudio(result,audio,transport){
  const stream=result.streams[0];if(stream?.type!=='mkv')return;
  const metadata=await defaultAudio(stream.url,transport).catch(()=>null);
  if(metadata?.language){const language=metadata.language.toLowerCase();const expected=audio==='dub'?['en','eng']:['ja','jpn'];if(!expected.includes(language)&&language!=='und')throw new ProviderError('Audio language mismatch','unsupported_audio');}
}
