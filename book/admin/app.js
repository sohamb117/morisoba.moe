const $=s=>document.querySelector(s),form=$('#page-form');
let csrf='',types=[],editing=null,dirty=false;
const home=(location.pathname.startsWith('/book/')?'/book/admin/':'/admin/');
const publicBase=location.hostname==='calendar.morisoba.moe'?location.origin:'https://calendar.morisoba.moe';
const guestUrl=slug=>location.hostname.endsWith('.chatgpt.site')?location.origin+'/'+slug:publicBase+'/'+slug;
const ownZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
for(const z of [...new Set([ownZone,'America/New_York',...(Intl.supportedValuesOf?.('timeZone')||[]),'UTC'])]){const o=document.createElement('option');o.value=z;o.textContent=z.replaceAll('_',' ');$('#zones').append(o);}
async function api(path,data,method='POST'){
 const r=await fetch('/api/booking/admin/'+path,{credentials:'include',method:data===undefined?'GET':method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(data===undefined?{}:{body:JSON.stringify(data)})});
 if(r.status===401){location.replace(home+'login.html');throw Error('Sign in required');}
 const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d;
}
function text(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
function render(){
 $('#list').replaceChildren();$('#count').textContent=types.length;
 if(!types.length){const p=text('p','No booking pages yet.');p.className='empty';$('#list').append(p);return;}
 for(const t of types){const row=document.createElement('article');row.className='row';row.append(text('h2',t.title));const badge=text('span',t.enabled?'Active':'Paused');badge.className='badge';row.append(badge,text('p',t.duration+' min · '+t.timezone),text('p','calendar.morisoba.moe/'+t.slug));
 const actions=document.createElement('div');actions.className='actions';const edit=text('button','Edit');edit.onclick=()=>open(t);const link=text('a','Open page ↗');link.href=guestUrl(t.slug);link.target='_blank';link.rel='noopener';const copy=text('button','Copy link');copy.onclick=async()=>{try{await navigator.clipboard.writeText(guestUrl(t.slug));copy.textContent='Copied';}catch{$('#status').textContent=guestUrl(t.slug);}};
 actions.append(edit,link,copy);row.append(actions);$('#list').append(row);}
}
function close(){if(dirty&&!confirm('Discard unsaved changes?'))return false;$('#editor').hidden=true;dirty=false;return true;}
function open(t){
 if(dirty&&!confirm('Discard unsaved changes?'))return;
 editing=t?.slug||null;form.reset();form.elements.slug.disabled=!!t;
 for(const key of ['slug','title','description','location','duration','timezone','noticeHours','horizonDays'])form.elements[key].value=t?.[key]??({duration:30,timezone:ownZone,noticeHours:24,horizonDays:30}[key]??'');
 const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
 form.elements.start.value=clock(t?.startMinute??780);form.elements.end.value=clock(t?.endMinute??1020);
 for(const c of form.querySelectorAll('[name=day]'))c.checked=(t?.days||[1,2,3,4,5]).includes(+c.value);
 form.elements.enabled.checked=t?.enabled!==false;$('#editor-title').textContent=t?'Edit page':'New page';$('#save').textContent=t?'Save changes':'Create page';$('#form-error').textContent='';$('#editor').hidden=false;dirty=false;updateUrl();$('#editor').scrollIntoView({behavior:'smooth',block:'start'});form.elements.title.focus({preventScroll:true});
}
function updateUrl(){$('#url').textContent='calendar.morisoba.moe/'+(form.elements.slug.value||'booking_name');}
form.oninput=()=>{dirty=true;updateUrl();};
form.onsubmit=async e=>{
 e.preventDefault();$('#save').disabled=true;$('#form-error').textContent='';
 const minutes=v=>{const [h,m]=v.split(':').map(Number);return h*60+m;};
 const d={slug:form.elements.slug.value,title:form.elements.title.value,description:form.elements.description.value,location:form.elements.location.value,duration:+form.elements.duration.value,timezone:form.elements.timezone.value,noticeHours:+form.elements.noticeHours.value,horizonDays:+form.elements.horizonDays.value,startMinute:minutes(form.elements.start.value),endMinute:minutes(form.elements.end.value),days:[...form.querySelectorAll('[name=day]:checked')].map(c=>+c.value),enabled:form.elements.enabled.checked};
 try{await api(editing?'types/'+editing:'types',d,editing?'PUT':'POST');types=(await api('types')).types;render();dirty=false;close();$('#status').textContent='Page saved.';}catch(err){$('#form-error').textContent=err.message;}finally{$('#save').disabled=false;}
};
$('#new').onclick=()=>open();$('#close').onclick=close;$('#discard').onclick=close;
$('#logout').onclick=async()=>{if(dirty&&!confirm('Discard unsaved changes and sign out?'))return;try{await api('logout',{});dirty=false;location.replace(home+'login.html');}catch(e){$('#status').textContent=e.message;}};
addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
(async()=>{try{const s=await api('session');if(!s.authenticated){location.replace(home+'login.html');return;}csrf=s.csrf;types=(await api('types')).types;render();await checkConnection();await loadBookings();}catch(e){$('#status').textContent=e.message;}})();

$('#password-form').onsubmit=async e=>{
 e.preventDefault();const f=e.target,button=$('#change-password'),error=$('#password-error');error.textContent='';
 if(f.elements.newPassword.value!==f.elements.confirmPassword.value){error.textContent='New passwords do not match.';return;}
 if(dirty&&!confirm('Changing your password signs you out. Discard unsaved page changes?'))return;
 button.disabled=true;
 try{await api('password',Object.fromEntries(new FormData(f)));f.reset();dirty=false;location.replace(home+'login.html?password=changed');}catch(err){error.textContent=err.message;}finally{button.disabled=false;}
};

async function checkConnection(){
 $('#check-connection').disabled=true;
 try{const c=await api('calendar');$('#connection').textContent=c.message+(c.connected?' Calendar: '+c.calendar:'');}catch(e){$('#connection').textContent=e.message;}finally{$('#check-connection').disabled=false;}
}
async function loadBookings(){
 const {bookings}=await api('bookings');$('#bookings').replaceChildren();
 if(!bookings.length){$('#bookings').append(text('p','No upcoming bookings.'));return;}
 for(const b of bookings){const row=document.createElement('article');row.className='row';row.append(text('h2',b.title),text('p',new Date(b.start).toLocaleString()+' · '+b.duration+' min'),text('p',b.pending?'Update awaiting confirmation':b.status));const a=text('a','Manage booking ↗');a.href=b.manageUrl;a.target='_blank';a.rel='noopener';row.append(a);$('#bookings').append(row);}
}
$('#check-connection').onclick=checkConnection;
