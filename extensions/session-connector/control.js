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
 window.addEventListener('message',async event=>{
  const m=event.data;
  if(event.source!==window||event.origin!==location.origin||m?.type!=='MORISOBA_X_CHAT_REQUEST'||typeof m.id!=='string')return;
  let response;
  try{
   const r=await fetch('/api/control/session',{credentials:'same-origin',cache:'no-store'});const session=await r.json();
   if(!r.ok||!session.authenticated)throw Error('Sign in to the control plane first.');
   response=await new Promise((resolve,reject)=>{
    const port=api.runtime.connect({name:'x-chat-control'});
    let settled=false;const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);port.disconnect();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>done(Error('X Chat did not respond. Check the X tab before retrying.')),22000);
    port.onMessage.addListener(value=>{done(null,value);});
    port.onDisconnect.addListener(()=>done(Error('X Chat connection closed. Reload both tabs.')));
    port.postMessage({route:m.route,channel:m.channel,cursor:m.cursor,write:m.write,text:m.text,nonce:m.nonce});
   });
   if(!response||typeof response!=='object')throw Error('X Chat did not return a response. Reload both tabs.');
  }catch(e){response={ok:false,error:e.message};}
  window.postMessage({type:'MORISOBA_X_CHAT_RESPONSE',id:m.id,...response},location.origin);
 });
 document.documentElement.dataset.morisobaChatBridge='1';
 // A sign-in updates this element; no page messages or DOM fields can request cookie access.
 const gate=document.querySelector('#entry-gate');
 const ready=()=>{if(gate?.hidden)api.runtime.sendMessage({type:'CONTROL_READY'}).catch(()=>{});};
 if(gate)new MutationObserver(ready).observe(gate,{attributes:true,attributeFilter:['hidden']});ready();
})();
