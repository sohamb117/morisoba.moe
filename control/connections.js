export function createConnections({api,openChat}){
 const root=document.querySelector('#connections-root');
 const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const button=(text,fn)=>{const n=node('button',text);n.onclick=fn;return n;};
 async function open(){
  root.replaceChildren(node('p','Checking…'));
  try{const data=await api('/connections');root.replaceChildren(button('Refresh',open));
   for(const c of data.connections){const row=node('section','');row.className='row';row.append(node('h2',c.name),node('p',c.account),node('p',c.apps.join(' · ')));
    if(c.id==='google'){
     row.append(node('p',c.events?'Events connected':c.eventError||'Events not connected'),node('p',c.calendarList?'Calendar list connected':c.listError||'Calendar list not connected'));
     row.append(button(c.calendarList?'Reconnect calendars':'Connect calendars',async e=>{const b=e.target;b.disabled=true;try{const r=await api('/calendar/connect',{});location.assign(r.url);}catch(err){row.append(node('p',err.message));b.disabled=false;}}));
    }else{row.append(node('p',c.connected?'Connected':'Unavailable'));if(c.connected)row.append(button('Open keyring',openChat));}root.append(row);
   }
  }catch(err){root.replaceChildren(node('p',err.message),button('Retry',open));}
 }
 return {open};
}
