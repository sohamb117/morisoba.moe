(()=>{
 if(window.top!==window||location.origin!=='https://morisoba.moe'||location.pathname!=='/control/')return;
 const api=globalThis.browser||chrome;
 api.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==api.runtime.id||message?.type!=='CONNECT_SESSION'||!['x','instagram'].includes(message.provider))return false;
  (async()=>{
   const r=await fetch('/api/control/session',{credentials:'same-origin',cache:'no-store',redirect:'error'});const session=await r.json();
   if(!r.ok||!session.authenticated||!session.csrf)throw Error('Sign in to the control plane first.');
   const names=message.provider==='x'?['auth_token','ct0']:['sessionid'];const auth={};
   for(const name of names){const value=message.auth?.[name];if(typeof value!=='string'||value.length<16||value.length>4096)throw Error('Missing session cookie');auth[name]=value;}
   const response=await fetch('/api/control/'+message.provider+'/connection',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify(auth)});
   if(!response.ok){const detail=await response.json().catch(()=>({}));throw Error(detail.error||'Connection rejected. Check the session in the original app.');}
   return {ok:true};
  })().then(respond,e=>respond({ok:false,error:e.message}));return true;
 });
 // A sign-in updates this element; no page messages or DOM fields can request cookie access.
 const gate=document.querySelector('#entry-gate');
 const ready=()=>{if(gate?.hidden)api.runtime.sendMessage({type:'CONTROL_READY'}).catch(()=>{});};
 if(gate)new MutationObserver(ready).observe(gate,{attributes:true,attributeFilter:['hidden']});ready();
})();
