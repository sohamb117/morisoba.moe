export function createConnections({api,openChat,openFeeds}){
 const root=document.querySelector('#connections-root');
 const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const button=(text,fn)=>{const n=node('button',text);n.onclick=fn;return n;};
 async function open(){
  root.replaceChildren(node('p','Checking…'));
  try{const data=await api('/connections');root.replaceChildren(button('Refresh',open));
   for(const c of data.connections){const row=node('section','');row.className='row';row.append(node('h2',c.name),node('p',c.account),node('p',c.apps.join(' · ')));
    if(['slack','x','instagram'].includes(c.id)){
     row.append(node('p',c.connected?'Connected':c.available===false?'Service setup pending':'Not connected'));
     const form=node('form',''),fields=c.id==='slack'?[['token','Slack OAuth user token']]:c.id==='x'?[['auth_token','auth_token'],['ct0','ct0']]:[['sessionid','sessionid']];
     for(const [name,title] of fields){const label=node('label',title),input=node('input','');input.name=name;input.type='password';input.autocomplete='off';input.required=true;input.disabled=c.available===false;label.append(input);form.append(label);}
     const submit=node('button','Connect');submit.type='submit';submit.disabled=c.available===false;const status=node('p','');status.setAttribute('role','status');form.append(submit,status);
     form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;const values=Object.fromEntries(new FormData(form));form.reset();try{await api('/'+c.id+'/connection',values);await open();}catch(err){status.textContent=err.message;}finally{submit.disabled=false;}};
     row.append(form);if(c.id==='slack'){submit.textContent='Add workspace';for(const w of c.workspaces||[]){const item=node('div','');item.append(node('span',w.account),button('Disconnect',async()=>{try{await api('/slack/connection?workspace='+encodeURIComponent(w.id),{},'DELETE');await open();}catch(e){status.textContent=e.message;}}));row.append(item);}}else if(c.connected)row.append(button('Disconnect',async()=>{try{await api('/'+c.id+'/connection',{},'DELETE');await open();}catch(e){status.textContent=e.message;}}));
    }else if(c.id==='remilia'){
     row.append(node('p',c.connected?'Connected':'Not connected'));const form=node('form','');form.innerHTML='<label>Login client ID<input name="clientId" required></label><button type="submit">Save client</button><p role="status"></p>';form.elements.clientId.value=c.clientId||'';form.onsubmit=async e=>{e.preventDefault();try{await api('/remilia/connection',{clientId:form.elements.clientId.value});await open();}catch(err){form.querySelector('[role=status]').textContent=err.message;}};row.append(form);const callback=node('p',c.callback);callback.className='connection-callback';row.append(callback);if(c.clientId)row.append(button('Log in with RemiliaNET',async()=>{try{const r=await api('/remilia/connect',{});location.assign(r.url);}catch(err){row.append(node('p',err.message));}}));if(c.connected)row.append(button('Disconnect',async()=>{try{await api('/remilia/connection',{},'DELETE');await open();}catch(e){row.append(node('p',e.message));}}));
    }else if(c.id==='discord'){
     row.append(node('p',c.connected?'Connected':'Not connected'));const form=node('form','');form.innerHTML='<label>Your Discord token<input name="token" type="password" autocomplete="off" required></label><button type="submit">Connect</button><p role="status"></p>';form.onsubmit=async e=>{e.preventDefault();const token=form.elements.token.value;form.elements.token.value='';const b=form.querySelector('button');b.disabled=true;try{await api('/discord/connection',{token});await open();}catch(err){form.querySelector('[role=status]').textContent=err.message;}finally{b.disabled=false;}};row.append(form);if(c.connected)row.append(button('Disconnect',async()=>{try{await api('/discord/connection',{},'DELETE');await open();}catch(e){row.append(node('p',e.message));}}));
    }else if(c.id==='google'){
     row.append(node('p',c.events?'Events connected':c.eventError||'Events not connected'),node('p',c.calendarList?'Calendar list connected':c.listError||'Calendar list not connected'));
     row.append(button(c.calendarList?'Reconnect calendars':'Connect calendars',async e=>{const b=e.target;b.disabled=true;try{const r=await api('/calendar/connect',{});location.assign(r.url);}catch(err){row.append(node('p',err.message));b.disabled=false;}}));
    }else if(c.id==='github'){
     row.append(node('p',c.connected?'Connected':'Not connected'));
     const form=node('form','');form.innerHTML='<label>GitHub access token<input name="token" type="password" autocomplete="off" required></label><p>Read access: Metadata, Issues, Pull requests.</p><button type="submit">Connect</button><p role="status"></p>';
     const tokenLink=node('a','Create token ↗');tokenLink.href='https://github.com/settings/personal-access-tokens/new';tokenLink.target='_blank';tokenLink.rel='noopener noreferrer';form.prepend(tokenLink);
     form.onsubmit=async e=>{e.preventDefault();const token=form.elements.token.value;form.elements.token.value='';const b=form.querySelector('button');b.disabled=true;try{await api('/github/connection',{token});await open();}catch(err){form.querySelector('[role=status]').textContent=err.message;}finally{b.disabled=false;}};row.append(form);
     if(c.connected)row.append(button('Disconnect',async()=>{if(!confirm('Disconnect GitHub?'))return;try{await api('/github/connection',{},'DELETE');await open();}catch(e){row.append(node('p',e.message));}}));
    }else if(c.id==='rss'){row.append(button('Edit subscriptions',openFeeds));
    }else if(c.id==='spotify'){row.append(node('p',c.connected?'Connected':'Not connected'),button('Connect playback',async()=>{try{const r=await api('/spotify/connect',{});location.assign(r.url);}catch(e){row.append(node('p',e.message));}}));
    }else{row.append(node('p',c.connected?'Connected':'Unavailable'));if(c.connected)row.append(button('Open keyring',openChat));}root.append(row);
   }
  }catch(err){root.replaceChildren(node('p',err.message),button('Retry',open));}
 }
 return {open};
}
