import {catalogue} from './catalog.js';
import {releaseHints} from './releases.js';
import {attachCaptions,clearCaptions} from './captions.js';
const $=id=>document.getElementById(id);
const state={providers:[],title:null,sources:[],audio:'sub',episode:null,hls:null,generation:0,playGeneration:0,searchGeneration:0};
const statusNames={available:'AVAILABLE',not_found:'NO MATCH',not_configured:'NOT CONNECTED',unavailable:'UNAVAILABLE',blocked:'BLOCKED'};
async function api(path,body){const response=await fetch('/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});let value;try{value=await response.json();}catch{throw new Error('API returned an invalid response');}if(response.status===401)window.dispatchEvent(new Event('ani-sign-in'));if(!response.ok){const error=new Error(value.error||'Request failed');error.code=value.code;throw error;}return value;}
function el(tag,text,cls){const node=document.createElement(tag);if(text!=null)node.textContent=text;if(cls)node.className=cls;return node;}
function history(){try{return JSON.parse(localStorage.getItem('ani.history')||'[]').filter(x=>x&&Number.isInteger(x.id)).slice(0,20);}catch{return [];}}
function saveProgress(seconds=0){if(!state.title||!state.episode)return;const item={id:state.title.id,title:state.title.title,episode:state.episode,audio:state.audio,seconds,updated:Date.now()};try{localStorage.setItem('ani.history',JSON.stringify([item,...history().filter(x=>x.id!==item.id)].slice(0,20)));}catch{}renderHistory();}
function renderHistory(){$('history-panel').hidden=history().length===0;$('history').replaceChildren();for(const item of history()){const b=el('button',item.title);b.append(el('small',`EP ${item.episode} / ${item.audio.toUpperCase()}${item.seconds?` / ${Math.floor(item.seconds/60)} MIN`:''}`));b.onclick=()=>openTitle(item.id,item);$('history').append(b);}}
function renderProviders(){}
async function search(query=''){state.generation++;stopPlayer();$('detail-panel').hidden=true;$('player-panel').hidden=true;$('catalog-panel').hidden=false;const generation=++state.searchGeneration;$('catalog-status').textContent='Searching…';$('catalog-label').textContent=query?'Search / '+query:'Trending';$('activity').textContent='SEARCHING';try{const results=await catalogue(query);if(generation!==state.searchGeneration)return;$('catalog').replaceChildren();for(const title of results){const card=el('button',null,'card');if(title.poster){const img=el('img');img.src=title.poster;img.alt='';img.loading='lazy';card.append(img);}card.append(el('b',title.title),el('small',[title.year,title.format,title.episodes?title.episodes+' EP':null].filter(Boolean).join(' / ')));card.onclick=()=>openTitle(title.id,null,title);$('catalog').append(card);}$('catalog-status').textContent=results.length?'':'No titles found.';}catch(error){if(generation===state.searchGeneration)$('catalog-status').textContent=error.message;}finally{if(generation===state.searchGeneration)$('activity').textContent='READY';}}
function stopPlayer(){state.playGeneration++;clearCaptions();if(state.hls){state.hls.destroy();state.hls=null;}const video=$('playback').querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}$('playback').replaceChildren();$('stream-options').replaceChildren();}
async function openTitle(id,resume=null,known=null){const generation=++state.generation;stopPlayer();state.title=null;state.sources=[];state.episode=null;state.audio=resume?.audio||'sub';$('audio').value=state.audio;$('player-panel').hidden=true;$('detail-panel').hidden=false;$('catalog-panel').hidden=true;$('title').textContent='Loading…';$('description').textContent='';$('metadata').textContent='';$('episodes').replaceChildren();$('availability').textContent='';renderProviders();try{const title=known||(await catalogue('',id))[0];if(generation!==state.generation)return;state.title=title;$('title').textContent=title.title;$('metadata').textContent=[title.year,title.format,title.episodes?title.episodes+' EP':null,title.score?title.score+' / 100':null].filter(Boolean).join(' / ');$('description').textContent=title.description;await api('debrid/catalog',{media:Object.fromEntries(['id','title','alternateTitle','synonyms','format','episodes','totalEpisodes','year','status'].map(k=>[k,title[k]]))});await discover(generation);if(generation!==state.generation)return;if(resume)showEpisode(resume.episode,resume.seconds);else {const first=episodeRows().map(e=>e.number).sort((a,b)=>a-b)[0];if(first)showEpisode(first);}$('player-panel').hidden?$('detail-panel').scrollIntoView({behavior:'smooth',block:'start'}):$('player-panel').scrollIntoView({behavior:'smooth',block:'start'});}catch(error){if(generation===state.generation)$('title').textContent=error.message;}}
async function discover(generation=state.generation){if(!state.title)return;const id=state.title.id;$('availability').textContent='Loading episodes…';$('refresh-sources').disabled=true;try{const result=await api(`debrid/episodes?mediaId=${id}`);if(generation!==state.generation)return;state.sources=result.sources;renderProviders();renderEpisodes();}catch(error){if(generation===state.generation)$('availability').textContent=error.message;}finally{if(generation===state.generation)$('refresh-sources').disabled=false;}}
function episodeRows(){return state.sources.flatMap(s=>s.episodes).filter(e=>e.audio===state.audio);}
function renderEpisodes(){const rows=episodeRows();$('refresh-sources').hidden=rows.length>0;const numbers=[...new Set(rows.map(e=>e.number))].sort((a,b)=>a-b);$('episodes').replaceChildren(...numbers.map(n=>{const b=el('button',String(n));b.title=rows.find(e=>e.number===n)?.title||`Episode ${n}`;b.onclick=()=>showEpisode(n);return b;}));const count=state.sources.filter(s=>s.status==='available').length;$('availability').textContent=numbers.length?`${numbers.length} episodes`:(state.title?.status==='NOT_YET_RELEASED'?'Not yet released.':'No aired episodes listed yet.');}
function showEpisode(number,resumeSeconds=0){stopPlayer();state.episode=number;state.fallbackCount=0;$('player-panel').hidden=false;$('playing-title').textContent=`${state.title.title} / EP ${number}`;$('player-status').textContent='Loading episode…';const choices=episodeRows().filter(e=>e.number===number);$('stream-options').replaceChildren();if(!choices.length)$('player-status').textContent='This episode is not available in the selected audio.';const next=[...new Set(episodeRows().map(e=>e.number))].filter(n=>n>number).sort((a,b)=>a-b)[0];$('next').disabled=!next;$('next').onclick=()=>showEpisode(next);if(choices.length)resolveEpisode(choices.find(e=>e.provider===state.preferredProvider)||choices[0],resumeSeconds);$('player-panel').scrollIntoView({behavior:'smooth',block:'start'});}
async function resolveEpisode(episode,resumeSeconds,retry=false,autoplay=false){
  state.preferredProvider=episode.provider;const generation=++state.playGeneration;
  $('player-status').textContent='Loading episode…';$('stream-options').replaceChildren();
  const retryButton=el('button','Try another');retryButton.onclick=()=>{$('source-menu').open=false;stopPlayer();resolveEpisode(episode,resumeSeconds,true);};
  try{
    let hints,failures=0;
    for(let attempt=0;attempt<60;attempt++){
      let result;
      try{result=await api('debrid/play',{mediaId:state.title.id,episode:episode.number,audio:episode.audio,retry:retry&&attempt===0,...(hints?{releases:hints}:{})});}
      catch(error){
        if(generation!==state.playGeneration)return;
        if(!hints&&['rate_limited','blocked','unavailable','upstream_error'].includes(error.code)){
          $('player-status').textContent='Finding episode…';
          hints=await releaseHints(state.title,episode.number).catch(()=>[]);
          if(generation!==state.playGeneration)return;
          if(hints.length)continue;
        }
        if(['rate_limited','upstream_error'].includes(error.code)&&failures++<3){
          $('player-status').textContent='Reconnecting…';
          await new Promise(r=>setTimeout(r,Math.min(15000,3000*2**failures)));
          if(generation!==state.playGeneration)return;continue;
        }
        throw error;
      }
      if(generation!==state.playGeneration)return;
      if(result.status==='ready'&&result.streams?.length){$('stream-options').replaceChildren(retryButton);play(result.streams[0],resumeSeconds,(position,wasPlaying)=>{if(generation!==state.playGeneration)return;if(++state.fallbackCount<=4){stopPlayer();resolveEpisode(episode,position,true,wasPlaying);}else $('player-status').textContent='This browser cannot play the available releases.';},autoplay);return;}
      $('player-status').textContent=result.progress>0?`Preparing episode… ${Math.floor(result.progress)}%`:(result.status==='searching'||result.searching?'Finding a ready episode…':'Preparing episode…');
      $('stream-options').replaceChildren(retryButton);
      await new Promise(resolve=>setTimeout(resolve,5000));if(generation!==state.playGeneration)return;
    }
    throw new Error('This release is taking too long. Try another.');
  }catch(error){if(generation===state.playGeneration){$('player-status').textContent=error.message;$('stream-options').replaceChildren(retryButton);}}
}
function play(stream,resumeSeconds,onFailure,autoplay=false){
  let failed=false,startup,position=resumeSeconds;const fail=()=>{if(failed)return;failed=true;clearTimeout(startup);onFailure?.(position,!video.paused);};if(state.hls){state.hls.destroy();state.hls=null;}$('playback').replaceChildren();$('player-status').textContent='';if(stream.type==='embed'){$('player-status').textContent='This stream is unavailable for direct playback.';return;}
  const video=el('video');video.controls=true;video.playsInline=true;video.autoplay=autoplay;video.preload='metadata';$('playback').append(video);for(const subtitle of stream.subtitles||[]){const track=el('track');track.kind='subtitles';track.src=subtitle.url;track.label=subtitle.label;track.srclang=subtitle.lang;video.append(track);}video.addEventListener('loadedmetadata',()=>{if(resumeSeconds>0&&resumeSeconds<video.duration)video.currentTime=resumeSeconds;});let saved=0;video.addEventListener('timeupdate',()=>{if(video.currentTime>0)position=video.currentTime;if(Date.now()-saved>5000){saveProgress(video.currentTime);saved=Date.now();}});video.addEventListener('pause',()=>saveProgress(video.currentTime));video.addEventListener('error',fail,{once:true});startup=setTimeout(()=>{if(video.isConnected&&video.readyState<2)fail();},20000);video.addEventListener('loadeddata',()=>clearTimeout(startup),{once:true});
  if(stream.type==='hls'&&window.Hls?.isSupported()){if(!window.Hls?.isSupported()){$('player-status').textContent='HLS playback is unavailable in this browser.';return;}const hls=new window.Hls();state.hls=hls;hls.loadSource(stream.url);hls.attachMedia(video);hls.on(window.Hls.Events.ERROR,(_,data)=>{if(data.fatal){console.warn('Playback failure',data.type,data.details);$('player-status').textContent='Playback is unavailable. Try another release.';fail();hls.destroy();if(state.hls===hls)state.hls=null;}});}else video.src=stream.url;
  attachCaptions(video,state.title.id,state.episode);
}
$('search').onsubmit=event=>{event.preventDefault();search($('query').value.trim());};$('reload').onclick=()=>search($('query').value.trim());$('refresh-sources').onclick=()=>discover();$('audio').onchange=()=>{state.audio=$('audio').value;const number=state.episode;const seconds=$('playback').querySelector('video')?.currentTime||0;renderEpisodes();if(number)showEpisode(number,seconds);};$('close-detail').onclick=()=>{state.generation++;stopPlayer();state.title=null;state.sources=[];$('detail-panel').hidden=true;$('player-panel').hidden=true;$('catalog-panel').hidden=false;renderProviders();};$('clear-history').onclick=()=>{try{localStorage.removeItem('ani.history');}catch{}renderHistory();};$('texture').onclick=()=>{const off=document.body.classList.toggle('no-texture');$('texture').textContent=off?'CRT OFF':'CRT ON';$('texture').setAttribute('aria-pressed',String(!off));};
renderHistory();api('providers').then(result=>{state.providers=result.providers;renderProviders();}).catch(error=>{console.warn('Provider registry unavailable');});search();

window.addEventListener('ani-signed-in',()=>{if(state.title)openTitle(state.title.id);});
