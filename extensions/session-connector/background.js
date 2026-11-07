const api=globalThis.browser||chrome;
const CONTROL='https://morisoba.moe/control/';
const origins={x:['https://x.com/*'],instagram:['https://www.instagram.com/*']};
const pending=new Map();
function controlTab(sender){try{const u=new URL(sender.url);return sender.id===api.runtime.id&&sender.tab&&u.origin==='https://morisoba.moe'&&u.pathname==='/control/';}catch{return false;}}
async function cookies(provider){
 const read=async(url,name)=>{const c=await api.cookies.get({url,name});return c?.value;};
 const auth=provider==='x'?{auth_token:await read('https://x.com/','auth_token'),ct0:await read('https://x.com/','ct0')}:{sessionid:await read('https://www.instagram.com/','sessionid')};
 if(Object.values(auth).some(value=>!value))throw Error('Sign in to '+(provider==='x'?'x.com':'instagram.com')+' in this browser’s default profile first.');
 return auth;
}
async function fingerprint(provider,auth){const value=provider==='x'?auth.auth_token:auth.sessionid;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
async function sync(provider,manual=false){
 if(pending.has(provider))return pending.get(provider);
 const task=(async()=>{
  if(!origins[provider])throw Error('Unknown service');
  if(!await api.permissions.contains({origins:origins[provider]}))throw Error('Allow access to '+provider+' in the extension.');
  const tabs=await api.tabs.query({url:CONTROL+'*'});
  if(!tabs.length){if(manual)await api.tabs.create({url:CONTROL});throw Error('Open the control plane and sign in.');}
  const auth=await cookies(provider),hash=await fingerprint(provider,auth),state=await api.storage.local.get(['enabled','fingerprints']);
  if(!manual&&state.fingerprints?.[provider]===hash)return {ok:true};
  const tab=tabs.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];
  let result;try{result=await api.tabs.sendMessage(tab.id,{type:'CONNECT_SESSION',provider,auth},{frameId:0});}catch{throw Error('Refresh the control-plane tab, then try again.');}
  if(!result?.ok)throw Error(result?.error||'Connection failed');
  // Only a one-way fingerprint is retained; never cookies or access tokens.
  const latest=await api.storage.local.get('fingerprints');await api.storage.local.set({fingerprints:{...latest.fingerprints,[provider]:hash}});
  return {ok:true};
 })();pending.set(provider,task);try{return await task;}finally{pending.delete(provider);}
}
async function automatic(){const state=await api.storage.local.get(['enabled','auto']);if(!state.auto)return;for(const provider of state.enabled||[])try{await sync(provider);}catch{/* Surface connection state in the popup; never log credential-bearing errors. */}}
api.runtime.onMessage.addListener((message,sender,respond)=>{
 if(controlTab(sender)&&message?.type==='CONTROL_READY'){automatic();respond({ok:true});return false;}
 if(sender.id!==api.runtime.id||sender.url!==api.runtime.getURL('popup.html'))return false;
 if(message?.type==='CONNECT'&&origins[message.provider]){
  (async()=>{const state=await api.storage.local.get('enabled');await api.storage.local.set({enabled:[...new Set([...(state.enabled||[]),message.provider])]});return sync(message.provider,true);})().then(respond,e=>respond({ok:false,error:e.message}));return true;
 }
 return false;
});
api.cookies.onChanged.addListener(change=>{
 const domain=change.cookie.domain.replace(/^\./,'');if(change.removed)return;
 if(domain==='x.com'&&change.cookie.name==='auth_token'||domain==='instagram.com'&&change.cookie.name==='sessionid')automatic();
});
api.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='session-sync')automatic();});
api.runtime.onInstalled.addListener(()=>api.alarms.create('session-sync',{periodInMinutes:5}));
api.runtime.onStartup.addListener(()=>api.alarms.create('session-sync',{periodInMinutes:5}));
