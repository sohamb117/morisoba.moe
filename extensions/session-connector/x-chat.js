(()=>{
 if(window.top!==window||location.origin!=='https://x.com')return;
 const api=globalThis.browser||chrome;
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 function all(selector){const roots=[document],found=[];for(let i=0;i<roots.length;i++){const root=roots[i];found.push(...root.querySelectorAll(selector));for(const n of root.querySelectorAll('*'))if(n.shadowRoot)roots.push(n.shadowRoot);}return found;}
 const q=id=>all(`[data-testid="${CSS.escape(id)}"]`)[0];
 const sent=new Set();let active=null,activeKey='';
 async function until(fn){for(let i=0;i<60;i++){const result=fn();if(result)return result;await wait(200);}throw Error('X Chat did not finish loading. Check the X tab.');}
 function unlocked(){if(!location.pathname.startsWith('/i/chat')||location.pathname.includes('/pin/'))throw Error('Open and unlock X Chat in Safari first.');}
 function rows(){const known=all('[data-testid^="dm-conversation-item-"]');return known.length?known:[...(all('[aria-label="Conversations"]')[0]?.querySelectorAll('a[href]')||[])].filter(n=>/\/i\/chat\/(?:conversations\/)?[\w-]+$/.test(n.getAttribute('href')));}
 function rowId(n){const link=n.matches('a')?n:n.querySelector('a[href]');if(link)return decodeURIComponent(new URL(link.getAttribute('href'),location.origin).pathname.split('/').filter(Boolean).pop());return n.dataset.testid?.slice('dm-conversation-item-'.length)||'';}
 function messages(){return all('[data-testid^="message-"]').filter(n=>/^message-[\w-]+$/.test(n.dataset.testid)&&n.hasAttribute('data-send-status')).map(n=>{
  const id=n.dataset.testid.slice(8),text=q('message-text-'+id)?.innerText||'';
  const labels=((n.matches('[aria-labelledby]')?n:n.querySelector('[aria-labelledby]'))?.getAttribute('aria-labelledby')||'').split(' ').map(id=>n.getRootNode().getElementById(id)?.textContent||'').filter(Boolean);
  return {id,text:text||'[attachment]',author:labels[0]||'',images:[...n.querySelectorAll('img')].map(i=>i.src).filter(s=>s.startsWith('https://')).slice(0,4)};
 });}
 async function run(m){
  unlocked();
  if(m.route==='conversations'){
   const list=q('dm-conversation-list')||all('[aria-label="Conversations"]')[0];if(!list)throw Error('Open X Chat in Safari first.');
   if(m.cursor){const scroller=q('dm-conversation-scroller')||list;scroller.scrollTop=scroller.scrollHeight;await wait(700);}
   if(!rows().length)return {items:[],cursor:''};
   const items=rows().map(n=>({id:rowId(n),name:n.innerText.split('\n').find(s=>s.trim())||'chat'}));
   return {items,cursor:q('dm-conversation-list-loading-footer')?'more':''};
  }
  if(!/^[\w:.-]{1,200}$/.test(m.channel||''))throw Error('Invalid conversation');
  const row=rows().find(n=>rowId(n)===m.channel);const link=row?.matches('a')?row:row?.querySelector('a[href]');
  if(!location.pathname.split('/').some(part=>decodeURIComponent(part)===m.channel)){
   if(!link)throw Error('Load this conversation in X Chat first.');
   link.click();await until(()=>location.pathname.split('/').some(part=>decodeURIComponent(part)===m.channel)&&(q('dm-message-list')||all('[aria-label="Messages"]')[0]));
  }
  await until(()=>q('dm-message-list')||all('[aria-label="Messages"]')[0]);
  if(m.write){
   if(typeof m.text!=='string'||!m.text.trim()||m.text.length>4000||!m.nonce)throw Error('Invalid message');
   if(sent.has(m.nonce))throw Error('Send already attempted. Check X before retrying.');
   const input=q('dm-composer-form')?.querySelector('textarea');
   if(!input)throw Error('X Chat composer unavailable');
   if(input.value.trim())throw Error('An unsent draft is open in X. Clear or send it there first.');
   const before=new Set(messages().map(x=>x.id));
   Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,m.text);
   input.dispatchEvent(new Event('input',{bubbles:true}));
   const send=await until(()=>{const b=q('dm-composer-send-button');return b&&!b.disabled?b:null;});
   sent.add(m.nonce);if(sent.size>100)sent.delete(sent.values().next().value);
   send.click();
   try{await until(()=>messages().some(x=>!before.has(x.id)&&x.text===m.text&&q('message-'+x.id)?.dataset.sendStatus==='sent'));}
   catch{throw Error('Send result unknown. Check X before retrying.');}
   return {ok:true};
  }
  if(m.cursor){const scroller=q('dm-message-scroller');if(scroller){scroller.scrollTop=0;await wait(800);}}
  const items=messages();return {items,cursor:items.length&&items[0].id!==m.cursor?items[0].id:''};
 }
 function connect(){
  const port=api.runtime.connect({name:'x-chat-native'});let closed=false;
  port.onDisconnect.addListener(()=>{closed=true;setTimeout(()=>{try{connect();}catch{/* Reloading the extension invalidates this page context. */}},1500);});
  port.onMessage.addListener(m=>{
   const reply=value=>{if(!closed)port.postMessage({requestId:m.requestId,...value});};
   if(!['conversations','messages'].includes(m.route)){reply({ok:false,error:'Invalid chat request'});return;}
   const key=JSON.stringify([m.route,m.channel,m.cursor,m.write,m.nonce]);
   if(active&&key!==activeKey){reply({ok:false,error:'X Chat is busy. Try again.'});return;}
   if(!active){activeKey=key;active=run(m).finally(()=>{active=null;activeKey='';});}
   active.then(result=>reply({ok:true,result}),e=>reply({ok:false,error:e.message}));
  });
 }
 connect();
})();
