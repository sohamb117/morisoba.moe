const api=globalThis.browser||chrome;
const origins={x:['https://x.com/*'],instagram:['https://www.instagram.com/*']};
const status=document.querySelector('#status'),auto=document.querySelector('#auto');
api.storage.local.get('auto').then(data=>{auto.checked=!!data.auto;});
auto.onchange=()=>api.storage.local.set({auto:auto.checked});
for(const button of document.querySelectorAll('[data-provider]'))button.onclick=async()=>{
 const provider=button.dataset.provider;button.disabled=true;status.textContent='Connecting…';
 try{
  if(!await api.permissions.request({origins:origins[provider]})){status.textContent='Access was not granted.';return;}
  const result=await api.runtime.sendMessage({type:'CONNECT',provider});status.textContent=result?.ok?'Connected':result?.error||'Connection failed';
 }catch{status.textContent='Connection failed. Refresh the control-plane tab and try again.';}finally{button.disabled=false;}
};
