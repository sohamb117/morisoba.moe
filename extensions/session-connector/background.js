const api=globalThis.browser||chrome;
const CONTROL='https://morisoba.moe/control/';
const origins={x:['https://x.com/*'],instagram:['https://www.instagram.com/*','https://instagram.com/*']};
const pending=new Map();
function controlTab(sender){try{const u=new URL(sender.url||sender.tab?.url);return sender.id===api.runtime.id&&sender.tab&&u.origin==='https://morisoba.moe'&&u.pathname==='/control/';}catch{return false;}}
async function sourceContext(provider,manual){
 const tabs=await api.tabs.query({url:origins[provider]}),stores=await api.cookies.getAllCookieStores();
 const active=await api.tabs.query({active:true,currentWindow:true});
 const saved=await api.storage.local.get('sourceStores');
 const storeFor=tab=>tab.cookieStoreId||stores.find(store=>store.tabIds?.includes(tab.id))?.id;
 let source=manual?tabs.find(tab=>active.some(current=>current.id===tab.id)):null;
 if(!source&&saved.sourceStores?.[provider])source=tabs.find(tab=>storeFor(tab)===saved.sourceStores[provider]);
 if(!source){const ids=new Set(tabs.map(storeFor).filter(Boolean));if(ids.size<=1)source=tabs[0];}
 if(!source)throw Error('Open the '+(provider==='x'?'X':'Instagram')+' tab you want to connect, then click connect again.');
 const storeId=storeFor(source)||(stores.length===1?stores[0].id:null);
 if(!storeId)throw Error('Safari did not identify this tab cookie store. Reload the site tab and try again.');
 return {source,storeId,stores};
}
async function cookies(provider,storeId){
 const urls=provider==='x'?['https://x.com/']:['https://www.instagram.com/','https://instagram.com/'];
 const names=provider==='x'?['auth_token','ct0']:['sessionid'],auth={};
 for(const name of names){for(const url of urls){
  const found=await api.cookies.get({url,name,storeId});
  if(found?.value){auth[name]=found.value;break;}
  const matches=await api.cookies.getAll({url,name,storeId});
  const cookie=matches.find(c=>c.name===name&&c.value);if(cookie){auth[name]=cookie.value;break;}
 }}
 if(names.some(name=>!auth[name]))throw Error('Safari is not exposing the required '+(provider==='x'?'X':'Instagram')+' session cookies. Allow this extension on that website in Safari Settings > Extensions, then reload the site tab.');
 return auth;
}
async function fingerprint(provider,auth){const value=provider==='x'?auth.auth_token:auth.sessionid;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
async function sync(provider,manual=false){
 if(pending.has(provider))return pending.get(provider);
 const task=(async()=>{
  if(!origins[provider])throw Error('Unknown service');
  if(!await api.permissions.contains({origins:origins[provider]}))throw Error('Allow access to '+provider+' in the extension.');
  const {source,storeId,stores}=await sourceContext(provider,manual);
  const tabs=await api.tabs.query({url:CONTROL+'*'});
  const store=stores.find(s=>s.id===storeId);
  const sameStore=tabs.filter(tab=>tab.cookieStoreId===storeId||store?.tabIds?.includes(tab.id));
  const tab=sameStore.find(tab=>tab.windowId===source.windowId)||sameStore[0];
  if(!tab){if(manual)await api.tabs.create({url:CONTROL,windowId:source.windowId});throw Error('Sign in to the control plane in this Safari profile, then click connect again.');}
  const auth=await cookies(provider,storeId),hash=await fingerprint(provider,auth),state=await api.storage.local.get(['enabled','fingerprints']);
  if(!manual&&state.fingerprints?.[provider]===hash)return {ok:true};
  let result;try{result=await api.tabs.sendMessage(tab.id,{type:'CONNECT_SESSION',provider,auth},{frameId:0});}catch{throw Error('Refresh the control-plane tab, then try again.');}
  if(!result?.ok)throw Error(result?.error||'Connection failed');
  // Only a one-way fingerprint is retained; never cookies or access tokens.
  const latest=await api.storage.local.get(['fingerprints','sourceStores']);await api.storage.local.set({fingerprints:{...latest.fingerprints,[provider]:hash},sourceStores:{...latest.sourceStores,[provider]:storeId}});
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
api.cookies.onChanged?.addListener(change=>{
 const domain=change.cookie.domain.replace(/^\./,'');if(change.removed)return;
 if(domain==='x.com'&&change.cookie.name==='auth_token'||domain==='instagram.com'&&change.cookie.name==='sessionid')automatic();
});
api.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='session-sync')automatic();});
api.runtime.onInstalled.addListener(()=>api.alarms.create('session-sync',{periodInMinutes:5}));
api.runtime.onStartup.addListener(()=>api.alarms.create('session-sync',{periodInMinutes:5}));

const chatTabs=new Map();
api.runtime.onConnect.addListener(port=>{
 if(port.name==='x-chat-native'){
  const sender=port.sender;
  if(sender?.id!==api.runtime.id||!sender.tab||sender.frameId!==0||!/^https:\/\/x\.com\//.test(sender.url||sender.tab.url||'')){port.disconnect();return;}
  chatTabs.set(sender.tab.id,port);
  port.onDisconnect.addListener(()=>{if(chatTabs.get(sender.tab.id)===port)chatTabs.delete(sender.tab.id);});
  return;
 }
 if(port.name!=='x-chat-control'||!controlTab(port.sender)){port.disconnect();return;}
 let received=false,closed=false,native=null,listener=null,restore=null;
 port.onDisconnect.addListener(()=>{closed=true;if(native&&listener)native.onMessage.removeListener(listener);if(restore)restore();});
 port.onMessage.addListener(message=>{
  if(received)return;received=true;
  (async()=>{
   if(!['conversations','messages'].includes(message.route))throw Error('Invalid chat request');
   const {source,storeId,stores}=await sourceContext('x',false);
   if(port.sender.tab.cookieStoreId!==storeId&&!stores.find(s=>s.id===storeId)?.tabIds?.includes(port.sender.tab.id))throw Error('Open the control plane and X in the same Safari profile.');
   if(closed)return;
   native=chatTabs.get(source.id);if(!native)throw Error('Reload the X Chat tab to connect it.');
   const requestId=crypto.randomUUID();
   if(!source.active){await api.tabs.update(source.id,{active:true});restore=async()=>{try{const current=await api.tabs.get(source.id);if(current.active)await api.tabs.update(port.sender.tab.id,{active:true});}catch{/* The user may have closed either tab. */}};}
   listener=reply=>{if(!closed&&reply.requestId===requestId)port.postMessage(reply);};
   native.onMessage.addListener(listener);
   native.postMessage({...message,requestId});
  })().catch(e=>{if(!closed)port.postMessage({ok:false,error:e.message});});
 });
});
