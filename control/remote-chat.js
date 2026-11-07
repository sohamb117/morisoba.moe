import {createDiscordSidebar} from './discord-sidebar.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
export function createRemoteChat({provider,api,openConnections,ownerId}){
 const root=document.querySelector('#'+provider+'-root'),panel=root.closest('.app-window'),discord=provider==='discord';let started=false,stopped=false,pendingLoad=false,reloadChannels=null,channel='',cursor=null,reply=null,epoch=0,busy=false,timer,rows=new Map(),draftNonce='',draftText='';
 const drafts=new Map();
 const prefsKey='control.'+provider+'.'+ownerId;let saved={};try{saved=JSON.parse(localStorage.getItem(prefsKey)||'{}');}catch{}
 const toolbar=el('div'),status=el('p'),list=el('div'),form=el('form'),replyLabel=el('p'),input=el('textarea'),send=el('button','Send'),older=button('Older messages',()=>load(true));
 toolbar.className='actions';status.setAttribute('role','status');list.className='remote-chat-messages';input.name='message';input.rows=3;input.maxLength=discord?2000:8192;input.required=true;input.setAttribute('aria-label','Message');send.type='submit';form.append(replyLabel,input,send);older.hidden=true;
 const persist=()=>{try{localStorage.setItem(prefsKey,JSON.stringify(saved));}catch{}};
 const path=()=>'/'+provider+'/messages'+(discord?'?channel='+encodeURIComponent(channel):'');
 function render(){const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<80;list.replaceChildren();for(const m of rows.values()){
  const row=el('article');row.className='row';row.append(el('small',(m.author?.display_name||m.author?.handle||'Unknown')+' · '+new Date(m.created_at).toLocaleString()));if(m.reply_to_id)row.append(el('small','Reply to #'+m.reply_to_id));const text=el('p',m.text);text.className='post-body';row.append(text);
  for(const media of Array.isArray(m.media)?m.media:m.media?[m.media]:[]){try{const u=new URL(media.url,'https://www.remilia.net');if(u.protocol!=='https:')continue;const a=el('a',media.name||'Attachment ↗');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';row.append(a);}catch{}}
  if(m.reactions?.length)row.append(el('small',m.reactions.map(r=>r.emoji+' '+r.count).join(' · ')));
  row.append(button('Reply',()=>{reply=m.id;replyLabel.replaceChildren(el('span','Reply to '+(m.author?.display_name||m.author?.handle||m.id)),button('Cancel',()=>{reply=null;replyLabel.replaceChildren();}));input.focus();}));list.append(row);
 }if(nearBottom)list.scrollTop=list.scrollHeight;}
 async function load(previous=false){if(stopped||discord&&!channel)return;if(busy){if(!previous)pendingLoad=true;return;}busy=true;const run=epoch;try{const p=path()+(previous&&cursor?(discord?'&':'?')+'before='+encodeURIComponent(cursor):''),r=await api(p),data=r.data;if(run!==epoch)return;const messages=data.messages||[];if(previous){rows=new Map([...messages.map(m=>[String(m.id),m]),...rows]);}else for(const m of messages)rows.set(String(m.id),m);if(previous||!cursor){cursor=data.next_cursor;older.hidden=!data.has_more;}render();status.textContent='';}catch(e){if(run===epoch)status.textContent=e.message;}finally{busy=false;if(pendingLoad){pendingLoad=false;load();}}}
 form.onsubmit=async e=>{e.preventDefault();if(send.disabled||discord&&!channel)return;const text=input.value;if(!text.trim())return;if(new TextEncoder().encode(text).length>8192){status.textContent='Message is too long.';return;}if(text!==draftText){draftText=text;draftNonce=crypto.randomUUID().replaceAll('-','').slice(0,24);}send.disabled=true;const destination=path(),run=epoch;try{const r=await api(destination,{text,...(reply?{reply_to_id:reply}:{}),...(discord?{nonce:draftNonce}:{})});if(run!==epoch)return;rows.set(String(r.data.id),r.data);if(input.value===text)input.value='';draftText='';reply=null;replyLabel.replaceChildren();render();list.scrollTop=list.scrollHeight;status.textContent='';}catch(err){status.textContent=err.message;}finally{send.disabled=false;}};
 async function selectChannel(id){if(channel!==id){drafts.set(channel,input.value);input.value=drafts.get(id)||'';}channel=id;saved.channel=id;persist();epoch++;rows.clear();cursor=null;older.hidden=true;reply=null;replyLabel.replaceChildren();render();await load();}
 async function init(){toolbar.replaceChildren();toolbar.append(button('Connections',openConnections),button('Refresh',()=>discord&&reloadChannels?reloadChannels():load()));root.replaceChildren(toolbar,older,list,form,status);
  if(discord){const layout=el('div'),chat=el('div');layout.className='discord-layout';chat.className='discord-conversation';chat.append(older,list,form,status);
   const picker=createDiscordSidebar({api,saved,persist,selectChannel,onError:message=>{status.textContent=message;}});toolbar.prepend(picker.toggle,picker.heading);layout.append(picker.root,chat);root.replaceChildren(toolbar,layout);reloadChannels=async()=>{await picker.refresh();await load();};await reloadChannels();
  }else await load();
 }
 function poll(){clearTimeout(timer);if(stopped)return;timer=setTimeout(async()=>{if(!document.hidden&&!panel.hidden)await load();poll();},10000);}
 return {open:async()=>{stopped=false;if(!started){started=true;await init();poll();}else {if(discord&&!channel)await reloadChannels();else await load();poll();}},close:()=>{stopped=true;clearTimeout(timer);epoch++;rows.clear();list.replaceChildren();input.value='';}};
}
