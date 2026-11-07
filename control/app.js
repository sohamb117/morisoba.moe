import {createSpotifyControls} from './spotify.js';
import {createRemoteChat} from './remote-chat.js';
import {createFeedApps,createGithub} from './feed-apps.js';
import {createConnections} from './connections.js';
import {createDesktop,registerApps} from './desktop.js';
import {createGoogleCalendar} from './google-calendar.js';
import {initCalendar} from './calendar.js';
import {initCommunity} from './community.js';
import {initKeyring} from './keyring.js';
const $=s=>document.querySelector(s);
let csrf='',owner,started=false,closeKeyring=()=>{},closeRemote=()=>{};
async function api(path,data,method='POST'){
 const multipart=data instanceof FormData;
 const response=await fetch(path,{method:data===undefined?'GET':method,credentials:'same-origin',cache:'no-store',headers:{...(multipart?{}:{'Content-Type':'application/json'}),'X-CSRF-Token':csrf},...(data===undefined?{}:{body:multipart?data:JSON.stringify(data)})});
 const result=await response.json();if(response.status===401){lock();throw Error('Sign in required');}if(!response.ok)throw Error(result.error||'Request failed');return result;
}
function lock(){closeRemote();document.querySelectorAll('dialog[open]').forEach(d=>d.close());closeKeyring();$('#stage').hidden=true;$('#dock').hidden=true;$('#entry-gate').hidden=false;$('#desktop-bar').hidden=true;$('#app-launcher').hidden=true;csrf='';}
async function start(s){
 owner=s.user;csrf=s.csrf;$('#entry-gate').hidden=true;$('#stage').hidden=false;$('#dock').hidden=false;$('#desktop-bar').hidden=false;$('#owner-email').textContent=owner.email;$('#profile-form').elements.displayName.value=owner.displayName;$('#profile-form').elements.bio.value=owner.bio||'';
 if(started){location.reload();return;}started=true;
 const desktop=createDesktop({ownerId:owner.id});
 const connections=createConnections({api:(path,data,method)=>api('/api/control'+path,data,method),openChat:()=>launchChat(),openFeeds:()=>{desktop.open('app-rss-editor');feeds.edit();}});
 const openConnections=()=>{desktop.open('app-connections');connections.open();};
 const remilia=createRemoteChat({provider:'remilia',ownerId:owner.id,api:(path,data,method)=>api('/api/control'+path,data,method),openConnections});
 const discord=createRemoteChat({provider:'discord',ownerId:owner.id,api:(path,data,method)=>api('/api/control'+path,data,method),openConnections});
 const spotify=createSpotifyControls({api:(path,data)=>api('/api/control'+path,data),openConnections});
 closeRemote=()=>{remilia.close();discord.close();spotify.close();};
 const feeds=createFeedApps({api:(path,data,method)=>api('/api/control'+path,data,method)});
 const github=createGithub({api:path=>api('/api/control'+path),openConnections});
 const calendar=createGoogleCalendar({ownerId:owner.id,openConnections,api:(path,data,method)=>api('/api/control/calendar'+path,data,method)});
 let bookingStarted=false,adminStarted=false,chatStarted=false;
 const launchChat=()=>{desktop.open('app-chat');if(!chatStarted){closeKeyring=initKeyring({csrf,owner});chatStarted=true;}};
 const launch=(id,init)=>()=>{desktop.open(id);init?.();};
 registerApps($('#app-launcher'),[
  {name:'RemiliaNet Chat',launch:launch('app-remilia',()=>remilia.open())},
  {name:'Discord',launch:launch('app-discord',()=>discord.open())},
  {name:'Spotify',launch:launch('p-wave',()=>spotify.open())},
  {name:'GitHub',launch:launch('app-github',()=>github.open())},
  {name:'RSS Feed Viewer',launch:launch('app-rss-viewer',()=>feeds.view())},
  {name:'RSS Feed Editor',launch:launch('app-rss-editor',()=>feeds.edit())},
  {name:'Connection Manager',launch:openConnections},
  {name:'Calendar',launch:launch('app-calendar',()=>calendar.open())},
  {name:'Mimori-Chat',launch:launchChat},
  {name:'Mimori-Admin',launch:launch('app-admin',()=>{if(!adminStarted){initCommunity({protocolApi:()=>api('/api/control/mimori'),api:(path,data,method)=>api('/api/mimorigasaka/'+path,data,method)});adminStarted=true;}})},
  {name:'Upcoming Events',launch:launch('app-upcoming',()=>calendar.upcoming())},
  {name:'Booking Manager',launch:launch('app-booking',()=>{if(!bookingStarted){initCalendar({api:(path,data,method)=>api('/api/booking/admin/'+path,data,method),openPanel:()=>{$('#booking-editor').hidden=false;$('#booking-editor').scrollIntoView({block:'start'});},closePanel:()=>{$('#booking-editor').hidden=true;}});bookingStarted=true;}})}
 ]);
 if(location.hash==='#spotify-connected'){desktop.open('p-wave');spotify.open();history.replaceState(null,'',location.pathname);}
 if(location.hash==='#spotify-cancelled'){openConnections();history.replaceState(null,'',location.pathname);}
 if(location.hash==='#remilia-connected'){desktop.open('app-remilia');remilia.open();history.replaceState(null,'',location.pathname);}
 if(location.hash==='#remilia-cancelled'){openConnections();history.replaceState(null,'',location.pathname);}
 if(location.hash==='#calendar-connected'){openConnections();history.replaceState(null,'',location.pathname);}
}

$('#login-form').onsubmit=async e=>{
 e.preventDefault();const form=e.target,button=$('#sign-in');button.disabled=true;$('#auth-error').textContent='';
 try{
  const config=await api('/api/control/config');
  const entered=form.elements.user.value.trim();const email=entered===config.username?config.email:entered;
  const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:form.elements.password.value,returnSecureToken:true})});
  const result=await response.json();if(!response.ok)throw Error('User or password is incorrect.');
  await api('/api/control/login',{idToken:result.idToken});form.reset();await start(await api('/api/control/session'));
 }catch(err){$('#auth-error').textContent=err.message;}finally{form.elements.password.value='';button.disabled=false;}
};
$('#desktop-sign-out').onclick=$('#sign-out').onclick=async()=>{try{await api('/api/control/logout',{});location.reload();}catch(e){$('#profile-status').textContent=e.message;}};
$('#profile-form').onsubmit=async e=>{e.preventDefault();try{await api('/api/mimorigasaka/profile',Object.fromEntries(new FormData(e.target)),'PATCH');$('#profile-status').textContent='Saved.';}catch(err){$('#profile-status').textContent=err.message;}};
try{const s=await api('/api/control/session');if(s.authenticated)await start(s);}catch(e){$('#auth-error').textContent=e.message;}

$('#password-form').onsubmit=async e=>{
 e.preventDefault();const f=e.target,b=f.querySelector('button');$('#password-status').textContent='';if(f.elements.next.value!==f.elements.confirm.value){$('#password-status').textContent='Passwords do not match.';return;}b.disabled=true;
 try{const config=await api('/api/control/config');const call=async(action,data)=>{const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:'+action+'?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(action==='signInWithPassword'?'Current password is incorrect.':'Password change failed.');return d;};const signed=await call('signInWithPassword',{email:owner.email,password:f.elements.current.value,returnSecureToken:true});await call('update',{idToken:signed.idToken,password:f.elements.next.value,returnSecureToken:true});f.reset();await api('/api/control/logout-all',{});location.reload();}catch(err){$('#password-status').textContent=err.message;}finally{b.disabled=false;f.elements.current.value='';}
};
