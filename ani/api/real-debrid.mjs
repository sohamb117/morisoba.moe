import {cacheValue,readCached} from './cache.mjs';
import {TorBoxClient} from './torbox.mjs';
import {findCaptions,captionText} from './captions.mjs';
import {fetchJSON, httpsURL, ProviderError} from './provider.mjs';
import {torrentProvider,resolveTorrent} from './torrent-provider.mjs';

const API='https://api.real-debrid.com/rest/1.0/';
const id = value => { if(!/^[a-zA-Z0-9_-]{1,80}$/.test(String(value)))throw new ProviderError('Invalid identifier','invalid_request');return String(value); };

/** Metadata and link resolution only. Never fetches a media URL. */
export class RealDebridClient {
  #token;
  constructor(token,transport=fetch){if(!token)throw new ProviderError('Account is not connected','not_configured');this.#token=token;this.transport=(...args)=>transport(...args);}
  async request(path,fields) {
    const response=await this.transport(API+path,{method:fields?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${this.#token}`,...(fields?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(fields?{body:new URLSearchParams(fields).toString()}:{})});
    if(!response.ok){await response.body?.cancel();throw new ProviderError(response.status===401?'Reconnect your account':response.status===403?'Account access is unavailable':response.status===429?'Please try again shortly':response.status===451?'The streaming service rejected this release.':'Stream resolution failed',response.status===401?'authentication_required':response.status===429?'rate_limited':response.status===451?'blocked_release':'upstream_error');}
    if(response.status===204||response.status===202){await response.body?.cancel();return null;}
    // Reuse the bounded JSON reader; credentials never enter response data/errors.
    return fetchJSON(API+path,{},async()=>response);
  }
  async account(){const user=await this.request('user');return {connected:true,premium:user.type==='premium',expiresAt:user.expiration};}
  async addMagnet(magnet){let parsed;try{parsed=new URL(magnet);}catch{throw new ProviderError('Invalid magnet','invalid_request');}
    const hash=parsed.searchParams.getAll('xt').find(x=>/^urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(x));
    if(parsed.protocol!=='magnet:'||!hash||magnet.length>8192)throw new ProviderError('Invalid magnet','invalid_request');
    const result=await this.request('torrents/addMagnet',{magnet});return {id:id(result.id)};
  }
  async torrent(torrentId){return this.request('torrents/info/'+id(torrentId));}
  async select(torrentId,fileId){if(!Number.isSafeInteger(fileId)||fileId<1)throw new ProviderError('Invalid file','invalid_request');
    const torrent=await this.torrent(torrentId);const file=torrent.files?.find(f=>f.id===fileId);
    if(!file||! /\.(mp4|m4v|mkv|webm|avi)$/i.test(file.path)||/(?:^|[\W_])sample(?:[\W_]|$)/i.test(file.path))throw new ProviderError('Choose an episode video file','invalid_request');
    if(torrent.status==='waiting_files_selection')await this.request('torrents/selectFiles/'+id(torrentId),{files:String(fileId)});
    else if(file.selected!==1)throw new ProviderError('This torrent already has a different selection','selection_conflict');
    return {id:id(torrentId),fileId};
  }
  async resolve(torrentId,fileId){
    const torrent=await this.torrent(torrentId);
    if(['error','magnet_error','virus','dead'].includes(torrent.status))throw new ProviderError('This release is unavailable','unavailable');
    if(torrent.status!=='downloaded')return {status:'preparing',progress:Number(torrent.progress)||0,streams:[]};
    // Links correspond to selected files, not to the unfiltered file array.
    const selected=(torrent.files||[]).filter(f=>f.selected===1);const index=selected.findIndex(f=>f.id===fileId);
    if(index<0||!torrent.links?.[index])throw new ProviderError('Episode file was not selected','invalid_request');
    const link=httpsURL(torrent.links[index]);if(!link)throw new ProviderError('Invalid resolved link');
    const unlocked=await this.request('unrestrict/link',{link});
    const streams=[];const url=httpsURL(unlocked.download);
    if(url&&/\.(mp4|m4v|webm)$/i.test(unlocked.filename||''))streams.push({url,type:'mp4',label:'Original',subtitles:[]});
    if(!streams.length&&unlocked.streamable){
      const variants=await this.request('streaming/transcode/'+id(unlocked.id)).catch(()=>({}));
      for(const [label,value] of Object.entries(variants||{}))if(label.startsWith('hls')&&httpsURL(value))streams.push({url:httpsURL(value),type:'hls',label,subtitles:[]});
    }
    if(!streams.length&&url&&unlocked.streamable&&/\.mkv$/i.test(unlocked.filename||''))streams.push({url,type:'mkv',label:'Original',subtitles:[]});
    if(!streams.length)throw new ProviderError('This release is not available in a browser-compatible format','unsupported_format');
    return {status:'ready',streams,mediaProxy:false};
  }
}

/** Verify the owner's Access JWT before any account-backed operation. */
export async function authorizeOwner(request,env,transport=fetch){
  if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD||!env.ACCESS_OWNER_EMAIL)return false;
  if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN))return false;
  const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token||token.length>16000)return false;
  try {
    const parts=token.split('.');if(parts.length!==3)return false;
    const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const decode=s=>JSON.parse(new TextDecoder().decode(bytes(s)));
    const header=decode(parts[0]),claims=decode(parts[1]);const now=Math.floor(Date.now()/1000);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.iss!==`https://${env.ACCESS_TEAM_DOMAIN}`||!Number.isFinite(claims.exp)||claims.exp<=now||(claims.nbf&&claims.nbf>now)||claims.email!==env.ACCESS_OWNER_EMAIL||!(Array.isArray(claims.aud)?claims.aud:[claims.aud]).includes(env.ACCESS_AUD))return false;
    const jwks=await fetchJSON(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`,{},transport);
    const jwk=jwks.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256'));if(!jwk)return false;
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  }catch{return false;}
}

export async function handleDebrid(request,env,transport=fetch,context={}){
  const url=new URL(request.url);if(!url.pathname.startsWith('/api/debrid/'))return null;
  const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  const actor=await (context.authorize?context.authorize(request):authorizeOwner(request,env,transport));
  if(!actor)return json({error:'Sign in to continue'},401);
  const viewer=typeof actor==='object'?actor.id:'owner';
  const titleFor=async id=>(await readCached('viewer-title:'+viewer+':'+id))||context.catalog(null,id,transport);
  if(request.headers.get('Sec-Fetch-Site')==='cross-site'||(request.method==='POST'&&request.headers.get('Origin')!==url.origin))return json({error:'Invalid origin'},403);
  try{
    const client=env.TORBOX_TOKEN?new TorBoxClient(env.TORBOX_TOKEN,transport):new RealDebridClient(env.REAL_DEBRID_TOKEN,transport);
    if(request.method==='GET'&&url.pathname==='/api/debrid/playlist'){
      const audio=url.searchParams.get('audio');if(!['sub','dub'].includes(audio)||!env.TORBOX_TOKEN)throw new ProviderError('Invalid playback request','invalid_request');
      const text=await client.stream(url.searchParams.get('id'),url.searchParams.get('fileId'),audio);
      return new Response(text,{headers:{'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
    }
    if(request.method==='GET'&&['/api/debrid/captions','/api/debrid/caption'].includes(url.pathname)){
      const [media]=await titleFor(Number(url.searchParams.get('mediaId')));if(!media)throw new ProviderError('Title not found');
      const episode=Number(url.searchParams.get('episode'));
      if(url.pathname.endsWith('/caption'))return json({text:await captionText(media,episode,url.searchParams.get('id'),transport)});
      return json({captions:(await findCaptions(media,episode,transport)).map(({url,...caption})=>caption)});
    }
    if(request.method==='GET'&&url.pathname==='/api/debrid/episodes'){
      const mediaId=Number(url.searchParams.get('mediaId'));if(!Number.isSafeInteger(mediaId)||mediaId<1)throw new ProviderError('Invalid title','invalid_request');
      const [media]=await titleFor(mediaId);if(!media)throw new ProviderError('Title not found');
      return json({sources:[await torrentProvider(transport).search(media)]});
    }
    if(request.method==='GET'&&url.pathname==='/api/debrid/account')return json(await (env.TORBOX_TOKEN?new TorBoxClient(env.TORBOX_TOKEN,transport):client).account());
    if(request.method==='GET'&&url.pathname==='/api/debrid/torrent'){
      const t=await client.torrent(url.searchParams.get('id'));
      return json({id:t.id,status:t.status,progress:t.progress,files:(t.files||[]).map(f=>({id:f.id,path:f.path,bytes:f.bytes,selected:f.selected}))});
    }
    if(request.method!=='POST')return json({error:'Not found'},404);
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Expected JSON'},415);
    const reader=request.body?.getReader();if(!reader)return json({error:'Missing request'},400);
    let bodyText='';const decoder=new TextDecoder();let size=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>10000)return json({error:'Request too large'},413);bodyText+=decoder.decode(value,{stream:true});}bodyText+=decoder.decode();}finally{await reader.cancel();}
    let body;try{body=JSON.parse(bodyText);}catch{return json({error:'Invalid JSON'},400);}
    if(url.pathname==='/api/debrid/catalog'){
      const m=body.media;
      if(!m||!Number.isSafeInteger(m.id)||m.id<1||m.id>=100000000||typeof m.title!=='string'||!m.title.trim()||m.title.length>300)throw new ProviderError('Invalid AniList title','invalid_request');
      const str=v=>typeof v==='string'?v.slice(0,400):'';
      const count=v=>Number.isInteger(v)&&v>=0&&v<=2000?v:null;
      const media={id:m.id,title:m.title,alternateTitle:str(m.alternateTitle),synonyms:Array.isArray(m.synonyms)?m.synonyms.slice(0,30).map(str):[],format:str(m.format),episodes:count(m.episodes),totalEpisodes:count(m.totalEpisodes),year:Number.isInteger(m.year)?m.year:null,status:str(m.status)};
      // Browser metadata belongs only to this viewer; it cannot overwrite the shared catalogue.
      await cacheValue('viewer-title:'+viewer+':'+m.id,[media],86400);return json({ok:true});
    }
    if(url.pathname==='/api/debrid/play'){
      if(!Number.isSafeInteger(body.mediaId)||body.mediaId<1)throw new ProviderError('Invalid title','invalid_request');
      const [media]=await titleFor(body.mediaId);if(!media)throw new ProviderError('Title not found');
      const hints=(Array.isArray(body.releases)?body.releases:[]).slice(0,20).filter(r=>/^[a-f0-9]{40}$/i.test(r.hash)&&typeof r.title==='string'&&r.title.length<=250&&typeof r.filename==='string'&&r.filename.length<=300).map(r=>({hash:r.hash.toLowerCase(),title:r.title,filename:r.filename,audio:Array.isArray(r.audio)?r.audio.filter(l=>typeof l==='string'&&/^[a-z]{2,3}$/i.test(l)).slice(0,10):undefined,seeders:0,episodes:[body.episode]}));
      return json(await resolveTorrent(media,body.episode,body.audio,env,transport,body.retry===true,hints));
    }
    if(url.pathname==='/api/debrid/torrents')return json(await client.addMagnet(body.magnet),201);
    if(url.pathname==='/api/debrid/select')return json(await client.select(body.id,body.fileId));
    if(url.pathname==='/api/debrid/resolve')return json(await client.resolve(body.id,body.fileId));
    return json({error:'Not found'},404);
  }catch(error){return json({error:error instanceof ProviderError?error.message:'Resolution unavailable',code:error.code||'unavailable'},error.code==='invalid_request'?400:502);}
}
