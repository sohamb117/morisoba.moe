(()=>{
 if(window.top!==window||location.origin!=='https://morisoba.moe'||location.pathname!=='/control/')return;
 const api=globalThis.browser||chrome;
 async function connectSession(message){
  if(!['x','instagram'].includes(message.provider))throw Error('Unknown service');
   const r=await fetch('/api/control/session',{credentials:'same-origin',cache:'no-store',redirect:'error'});const session=await r.json();
   if(!r.ok||!session.authenticated||!session.csrf)throw Error('Sign in to the control plane first.');
   const names=message.provider==='x'?['auth_token','ct0']:['sessionid'];const auth={};
   for(const name of names){const value=message.auth?.[name];if(typeof value!=='string'||value.length<16||value.length>4096)throw Error('Missing session cookie');auth[name]=value;}
   const response=await fetch('/api/control/'+message.provider+'/connection',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify(auth)});
   if(!response.ok){const detail=await response.json().catch(()=>({}));throw Error(detail.error||'Connection rejected. Check the session in the original app.');}
   return {ok:true};
 }
 function sessionPort(){
  const port=api.runtime.connect({name:'control-session'});let closed=false;
  port.onMessage.addListener(message=>{
   if(message.type!=='CONNECT_SESSION'||typeof message.requestId!=='string')return;
   connectSession(message).then(result=>{if(!closed)port.postMessage({requestId:message.requestId,...result});},e=>{if(!closed)port.postMessage({requestId:message.requestId,ok:false,error:e.message});});
  });
  port.onDisconnect.addListener(()=>{closed=true;setTimeout(()=>{try{sessionPort();}catch{}},1500);});
 }
 sessionPort();
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
 const ready=()=>{if(gate?.hidden)Promise.resolve(api.runtime.sendMessage({type:'CONTROL_READY'})).catch(()=>{});};
 if(gate)new MutationObserver(ready).observe(gate,{attributes:true,attributeFilter:['hidden']});ready();
})();
