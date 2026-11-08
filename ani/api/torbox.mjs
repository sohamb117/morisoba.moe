import {directPlaylist} from './playlist.mjs';
import {fetchText,fetchJSON,httpsURL,ProviderError} from './provider.mjs';
const playlists=new Map();
const BASE='https://api.torbox.app/v1/api/';
const numeric=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw new ProviderError('Invalid file identifier','invalid_request');return n;};
export class TorBoxClient{
  #token;
  constructor(token,transport=fetch){if(!token)throw new ProviderError('Connect your account','not_configured');this.#token=token;this.transport=(...args)=>transport(...args);this.backend='torbox';}
  async call(path,options={}){
    let response;try{response=await this.transport(BASE+path,{...options,headers:{Authorization:'Bearer '+this.#token,...options.headers},redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw new ProviderError('Connection to the streaming service failed.','upstream_error');}
    const payload=await fetchJSON(BASE,{},async()=>new Response(response.body,{status:200})).catch(()=>null);
    if(!response.ok||!payload?.success){
      const code=payload?.error;
      if(response.status===401||['BAD_TOKEN','NO_AUTH'].includes(code))throw new ProviderError('Reconnect your account.','authentication_required');
      if(response.status===429)throw new ProviderError('Please try again shortly.','rate_limited');
      if(['PLAN_RESTRICTED_FEATURE','COOLDOWN_LIMIT','MONTHLY_LIMIT','ACTIVE_LIMIT','CAPTCHA_REQUIRED'].includes(code))throw new ProviderError('Your TorBox plan requires an account action before playback.','account_limit');
      if(response.status===451)throw new ProviderError('The streaming service rejected this release.','blocked_release');
      throw new ProviderError('This release is not available yet.','unavailable');
    }
    return payload.data;
  }
  async account(){const u=await this.call('user/me');return {connected:true,backend:'torbox',premium:Number(u.plan)>0,plan:u.plan};}
  async cached(hashes){if(!hashes.length)return new Set();const query=new URLSearchParams({format:'object',list_files:'false'});for(const hash of hashes.slice(0,100))if(/^[a-f\d]{40}$/i.test(hash))query.append('hash',hash);const data=await this.call('torrents/checkcached?'+query);return new Set(Array.isArray(data)?data.map(x=>typeof x==='string'?x:x.hash):Object.keys(data||{}));}
  normalize(t){return {id:String(t.id),hash:t.hash,filename:t.name,status:t.download_finished&&t.download_present?'downloaded':t.download_state==='metaDL'?'magnet_conversion':'downloading',progress:(Number(t.progress)||0)*100,files:(t.files||[]).map(f=>({id:f.id,path:f.name||f.short_name,bytes:f.size,selected:1}))};}
  async request(path){if(path!=='torrents?limit=100')throw new ProviderError('Unsupported operation');const data=await this.call('torrents/mylist?limit=100');return (Array.isArray(data)?data:[]).map(t=>this.normalize(t));}
  async torrent(id){const data=await this.call('torrents/mylist?id='+numeric(id)+'&bypass_cache=true');const t=Array.isArray(data)?data.find(t=>String(t.id)===String(id)):data;if(!t)throw new ProviderError('Episode is not ready yet.');return this.normalize(t);}
  async addMagnet(magnet,cachedOnly=true){const url=new URL(magnet);const xt=url.searchParams.get('xt');if(url.protocol!=='magnet:'||!/^urn:btih:[a-f\d]{40}$/i.test(xt||''))throw new ProviderError('Invalid release','invalid_request');const body=new FormData();body.set('magnet',magnet);body.set('seed','3');body.set('allow_zip','false');body.set('add_only_if_cached',String(cachedOnly));const t=await this.call('torrents/createtorrent',{method:'POST',body});return {id:String(numeric(t.torrent_id??t.id))};}
  async select(){return;}
  async stream(id,fileId,audio='sub'){
    const cacheKey=[this.#token,id,fileId,audio].join(':');const saved=playlists.get(cacheKey);if(saved?.expires>Date.now())return saved.text;
    const query=new URLSearchParams({id:String(numeric(id)),file_id:String(numeric(fileId)),type:'torrent',scrobbling_enabled:'false'});
    let data=await this.call('stream/createstream?'+query);
    const languages=audio==='dub'?['eng','en']:['jpn','ja'];
    const tracks=data.metadata?.audios||[];
    const track=tracks.findIndex(t=>languages.includes(t.language?.toLowerCase()));
    if(track<0)throw new ProviderError('Requested audio is unavailable','unsupported_audio');
    if(track!==Number(data.audio_index||0)){query.set('chosen_audio_index',String(track));data=await this.call('stream/createstream?'+query);}
    const url=httpsURL(data.hls_url);
    if(!url||!new URL(url).hostname.endsWith('.tb-cdn.io'))throw new ProviderError('Invalid playlist host');
    const text=directPlaylist(await fetchText(url,{},this.transport),url,this.#token);
    if(playlists.size>100)playlists.delete(playlists.keys().next().value);playlists.set(cacheKey,{text,expires:Date.now()+60000});return text;
  }
  async resolve(id,fileId,audio='sub'){
    const t=await this.torrent(id);if(t.status!=='downloaded')return {status:'preparing',progress:t.progress,streams:[]};
    if(!t.files.some(f=>f.id===fileId))throw new ProviderError('Episode file was not found.');
    // Validate the playlist before advertising playback. Only its key-free media URLs reach the browser.
    await this.stream(id,fileId,audio);
    return {status:'ready',streams:[{url:`/api/debrid/playlist?id=${numeric(id)}&fileId=${numeric(fileId)}&audio=${audio}`,type:'hls',subtitles:[]}],mediaProxy:false};
  }
}
