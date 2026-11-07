import {panelSettings} from './panel-settings.js';
import {appendChatText} from './chat-media.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const button=(label,fn)=>{const b=el('button',label);b.type='button';b.onclick=fn;return b;};
export function createSlack({api,openConnections,ownerId}){
 const panel=document.querySelector('#app-slack'),root=document.querySelector('#slack-root');
 const prefKey='control.slack.'+ownerId;let saved={};try{saved=JSON.parse(localStorage.getItem(prefKey)||'{}');}catch{}
 const persist=()=>{try{localStorage.setItem(prefKey,JSON.stringify(saved));}catch{}};
 let workspace='',channel='',thread='',epoch=0,stopped=false,refreshing=false,loading=false,timer,activityTimer,activityRun=0,items=[],cursor='',people=new Map(),drafts=new Map(),rows=new Map();
 const toolbar=el('div'),picker=el('select'),heading=el('span','Select a chat'),sidebar=el('nav'),layout=el('div'),chat=el('div'),list=el('div'),status=el('p'),activityStatus=el('small'),form=el('form'),input=el('textarea'),send=el('button','Send');
 const older=button('Older messages',()=>load(true)),back=button('Back to channel',()=>choose(channel));
 root.className='slack-root';toolbar.className='actions';picker.className='discord-server-picker';picker.setAttribute('aria-label','Slack workspace');heading.className='discord-current-chat';sidebar.className='discord-sidebar';sidebar.id='slack-sidebar';sidebar.setAttribute('aria-label','Slack conversations');layout.className='discord-layout';chat.className='discord-conversation';list.className='remote-chat-messages';status.setAttribute('role','status');input.rows=3;input.maxLength=4000;input.required=true;input.setAttribute('aria-label','Message');send.type='submit';older.hidden=true;back.hidden=true;form.append(input,send);chat.append(back,older,list,form,status);layout.append(sidebar,chat);
 const toggle=button('☰',()=>{saved.sidebarCollapsed=!saved.sidebarCollapsed;persist();collapse();});toggle.className='discord-sidebar-toggle';toggle.setAttribute('aria-label','Toggle channel sidebar');toggle.setAttribute('aria-controls',sidebar.id);
 function collapse(){sidebar.hidden=!!saved.sidebarCollapsed;toggle.setAttribute('aria-expanded',String(!sidebar.hidden));}collapse();toolbar.append(toggle,picker,heading);root.replaceChildren(toolbar,layout);
 const settings=panelSettings(panel);settings.add('Refresh',button('refresh',()=>refresh()));settings.add('Connections',button('connections',openConnections));
 const path=(route,params={})=>'/slack/'+route+'?'+new URLSearchParams({workspace,...params});
 const key=()=>workspace+'/'+channel+'/'+thread;
 const saveDraft=()=>{drafts.set(key(),input.value);};
 function choose(id,nextThread=''){
  saveDraft();channel=id;thread=nextThread;epoch++;loading=false;rows.clear();cursor='';input.value=drafts.get(key())||'';list.replaceChildren();older.hidden=true;back.hidden=!thread;form.hidden=!channel;
  saved.channels={...saved.channels,[workspace]:channel};persist();const c=items.find(c=>c.id===id);heading.textContent=c?((c.direct?'':'# ')+name(c)+(thread?' · thread':'')):'Select a chat';renderSidebar();load();
 }
 function name(c){return people.get(c.user)||c.name;}
 function renderSidebar(){
  const currentFocus=sidebar.contains(document.activeElement)?document.activeElement.dataset.channel:null;
  sidebar.replaceChildren();for(const [label,direct] of [['channels',false],['DMs',true]]){
   const section=el('details'),summary=el('summary',label);section.open=saved.sections?.[label]!==false;section.append(summary);
   const sorted=items.filter(c=>c.direct===direct).sort((a,b)=>Number(b.latest||0)-Number(a.latest||0)||name(a).localeCompare(name(b)));
   for(const c of sorted){const b=button((direct?'':'# ')+name(c),()=>choose(c.id));b.className='discord-channel';b.dataset.channel=c.id;b.title=name(c);if(c.id===channel)b.setAttribute('aria-current','page');section.append(b);}
   if(!sorted.length)section.append(el('small','None'));section.ontoggle=()=>{if(section.isConnected){saved.sections={...saved.sections,[label]:section.open};persist();}};sidebar.append(section);
  }sidebar.append(activityStatus);if(currentFocus)sidebar.querySelector('[data-channel="'+currentFocus+'"]')?.focus({preventScroll:true});
 }
 function markLatest(id,latest){const c=items.find(c=>c.id===id);if(!c||c.latest===latest)return;c.latest=latest;saved.activity={...saved.activity,[workspace]:{...saved.activity?.[workspace],[id]:latest}};persist();renderSidebar();}
 function updateActivity(){
  clearTimeout(activityTimer);const run=++activityRun,team=workspace,queue=[...items];let index=0;
  async function next(){if(stopped||run!==activityRun)return;if(document.hidden||panel.hidden){activityTimer=setTimeout(next,3000);return;}if(index>=queue.length){activityStatus.textContent='';activityTimer=setTimeout(()=>updateActivity(),60000);return;}
   activityStatus.textContent='Updating activity…';const c=queue[index];let delay=1500;
   try{const data=await api('/slack/activity?'+new URLSearchParams({workspace:team,channel:c.id}));if(run!==activityRun)return;markLatest(c.id,data.latest);index++;}
   catch(e){if(run!==activityRun)return;activityStatus.textContent=e.message;if(/rate limit/i.test(e.message)){delay=Math.max(60000,Number(e.message.match(/(\d+) seconds/)?.[1]||60)*1000);}else{index++;status.textContent=e.message;}}
   activityTimer=setTimeout(next,delay);
  }next();
 }
 function renderMessage(m){const row=el('article');row.className='row';row.append(el('small',(people.get(m.author)||m.author)+' · '+new Date(m.createdAt).toLocaleString()));const text=el('p');text.className='post-body';appendChatText(text,String(m.text||'').replace(/<@([A-Z0-9]+)>/g,(_,id)=>'@'+(people.get(id)||id)).replace(/<(https?:\/\/[^>|]+)(?:\|[^>]+)?>/g,'$1'));row.append(text);
  for(const file of m.files||[]){try{const u=new URL(file.url);if(u.protocol!=='https:')continue;const a=el('a',file.name||'Attachment');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';row.append(a);}catch{}}
  if(!thread)row.append(button(m.replies?m.replies+' replies':'Reply',()=>choose(channel,m.thread||m.id)));return row;
 }
 async function load(previous=false){if(stopped||!channel||loading)return;loading=true;const run=epoch;
  try{const data=await api(path('messages',{channel,...(thread?{thread}:{}),...(previous&&cursor?{cursor}:{})}));if(run!==epoch||stopped)return;
   const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<80,oldHeight=list.scrollHeight,oldTop=list.scrollTop;
   for(const m of data.items)rows.set(m.id,m);list.replaceChildren(...[...rows.values()].sort((a,b)=>Number(a.id)-Number(b.id)).map(renderMessage));if(previous||!cursor)cursor=data.cursor||'';older.hidden=!cursor;
   if(previous)list.scrollTop=oldTop+list.scrollHeight-oldHeight;else list.scrollTop=nearBottom?list.scrollHeight:oldTop;
   if(!thread&&data.items.length)markLatest(channel,data.items.at(-1).id);status.textContent='';
  }catch(e){if(run===epoch)status.textContent=e.message;}finally{if(run===epoch)loading=false;}
 }
 async function loadWorkspace(){
  const run=++epoch;loading=false;rows.clear();clearTimeout(activityTimer);activityRun++;items=[];people=new Map();channel='';thread='';input.value='';list.replaceChildren();older.hidden=true;back.hidden=true;form.hidden=true;heading.textContent='Select a chat';sidebar.replaceChildren(el('small','Loading…'));
  try{
   let cursor='';do{const data=await api(path('conversations',{...(cursor?{cursor}:{})}));if(run!==epoch||stopped)return;items.push(...data.items.map(c=>({...c,latest:c.latest||saved.activity?.[workspace]?.[c.id]||'0'})));cursor=data.cursor;}while(cursor);
   try{cursor='';do{const data=await api(path('users',{...(cursor?{cursor}:{})}));if(run!==epoch||stopped)return;for(const u of data.items)people.set(u.id,u.name);cursor=data.cursor;}while(cursor);}catch(e){if(run!==epoch)return;status.textContent=e.message;}
   renderSidebar();const selected=saved.channels?.[workspace];if(items.some(c=>c.id===selected))choose(selected);updateActivity();
  }catch(e){if(run===epoch){renderSidebar();status.textContent=e.message;}}
 }
 picker.onchange=()=>{saveDraft();workspace=picker.value;saved.workspace=workspace;persist();loading=false;loadWorkspace();};
 async function refresh(){if(refreshing)return;refreshing=true;saveDraft();try{const data=await api('/slack/workspaces');if(stopped)return;picker.replaceChildren(...data.items.map(w=>new Option(w.name,w.id)));workspace=data.items.find(w=>w.id===(workspace||saved.workspace))?.id||data.items[0]?.id||'';picker.value=workspace;saved.workspace=workspace;persist();if(workspace)await loadWorkspace();else{items=[];choose('');status.textContent='Connect Slack in Connection Manager';}}catch(e){status.textContent=e.message;}finally{refreshing=false;}}
 form.onsubmit=async e=>{e.preventDefault();if(send.disabled||!channel||!input.value.trim())return;send.disabled=true;const run=epoch,draft=input.value,draftId=key(),destination=path('messages',{channel});try{const data=await api(destination,{text:draft,thread:thread||undefined,nonce:crypto.randomUUID()});drafts.delete(draftId);if(run===epoch){if(input.value===draft)input.value='';markLatest(channel,data.item.id);await load();}}catch(e){status.textContent=e.message;}finally{send.disabled=false;}};
 function poll(){clearTimeout(timer);if(stopped)return;timer=setTimeout(async()=>{if(!document.hidden&&!panel.hidden)await load();poll();},15000);}
 return {async open(){stopped=false;await refresh();poll();},close(){stopped=true;epoch++;activityRun++;clearTimeout(timer);clearTimeout(activityTimer);drafts.clear();input.value='';list.replaceChildren();}};
}
