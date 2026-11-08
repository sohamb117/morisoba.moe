const api=globalThis.browser||chrome;
const origins={x:['https://x.com/*'],instagram:['https://www.instagram.com/*','https://instagram.com/*']};
const status=document.querySelector('#status'),auto=document.querySelector('#auto');
api.storage.local.get('auto').then(data=>{auto.checked=!!data.auto;});
auto.onchange=()=>api.storage.local.set({auto:auto.checked});
for(const button of document.querySelectorAll('[data-provider]'))button.onclick=async()=>{
 const provider=button.dataset.provider;button.disabled=true;status.textContent='Connecting...';
 try{
  if(!await api.permissions.request({origins:origins[provider]})){status.textContent='Access was not granted.';return;}
  const result=await new Promise((resolve,reject)=>{
   const port=api.runtime.connect({name:'session-popup'});let settled=false;
   const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);port.disconnect();error?reject(error):resolve(value);};
   const timer=setTimeout(()=>done(Error('Connection check timed out. Keep the control-plane tab open.')),50000);
   port.onMessage.addListener(value=>done(null,value));
   port.onDisconnect.addListener(()=>done(Error('Extension connection closed. Reload the control-plane tab.')));
   port.postMessage({provider});
  });status.textContent=result?.ok?'Connected':result?.error||'Connection failed';
 }catch(e){status.textContent=e.message||'Connection failed. Refresh the control-plane tab and try again.';}finally{button.disabled=false;}
};
