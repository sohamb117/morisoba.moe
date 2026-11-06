export function initCalendar({api,openPanel,closePanel}){
const $=s=>document.querySelector(s),form=$('#page-form');
let types=[],editing=null,dirty=false;
const guestUrl=slug=>'https://calendar.morisoba.moe/'+slug;
const ownZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
for(const z of [...new Set([ownZone,'America/New_York',...(Intl.supportedValuesOf?.('timeZone')||[]),'UTC'])]){const o=document.createElement('option');o.value=z;o.textContent=z.replaceAll('_',' ');$('#zones').append(o);}
function text(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
function render(){
 $('#list').replaceChildren();$('#count').textContent=types.length;
 if(!types.length){const p=text('p','No booking pages yet.');p.className='empty';$('#list').append(p);return;}
 for(const t of types){const row=document.createElement('article');row.className='row';row.append(text('h2',t.title));const badge=text('span',t.enabled?'Active':'Paused');badge.className='badge';row.append(badge,text('p',t.duration+' min · '+t.timezone),text('p','calendar.morisoba.moe/'+t.slug));
 const actions=document.createElement('div');actions.className='actions';const edit=text('button','Edit');edit.onclick=()=>open(t);const link=text('a','Open page ↗');link.href=guestUrl(t.slug);link.target='_blank';link.rel='noopener';const copy=text('button','Copy link');copy.onclick=async()=>{try{await navigator.clipboard.writeText(guestUrl(t.slug));copy.textContent='Copied';}catch{$('#status').textContent=guestUrl(t.slug);}};
 actions.append(edit,link,copy);row.append(actions);$('#list').append(row);}
}
function close(){if(dirty&&!confirm('Discard unsaved changes?'))return false;closePanel('p-vessel');dirty=false;return true;}
function open(t){
 if(dirty&&!confirm('Discard unsaved changes?'))return;
 editing=t?.slug||null;form.reset();form.elements.slug.disabled=!!t;
 for(const key of ['slug','title','description','location','duration','timezone','noticeHours','horizonDays','bufferBefore','bufferAfter','maxPerDay'])form.elements[key].value=t?.[key]??({duration:30,timezone:ownZone,noticeHours:24,horizonDays:30,bufferBefore:0,bufferAfter:0,maxPerDay:0}[key]??'');
 const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
 form.elements.start.value=clock(t?.startMinute??780);form.elements.end.value=clock(t?.endMinute??1020);
 for(const c of form.querySelectorAll('[name=day]'))c.checked=(t?.days||[1,2,3,4,5]).includes(+c.value);
 form.elements.googleMeet.checked=t?!!t.googleMeet:true;form.elements.reminders.checked=t?!!t.reminders:true;form.elements.enabled.checked=t?.enabled!==false;$('#editor-title').textContent=t?'Edit page':'New page';$('#save').textContent=t?'Save changes':'Create page';$('#form-error').textContent='';openPanel('p-vessel');dirty=false;updateUrl();form.elements.title.focus({preventScroll:true});
}
function updateUrl(){$('#url').textContent='calendar.morisoba.moe/'+(form.elements.slug.value||'booking_name');}
form.oninput=()=>{dirty=true;updateUrl();};
form.onsubmit=async e=>{
 e.preventDefault();$('#save').disabled=true;$('#form-error').textContent='';
 const minutes=v=>{const [h,m]=v.split(':').map(Number);return h*60+m;};
 const d={slug:form.elements.slug.value,title:form.elements.title.value,description:form.elements.description.value,location:form.elements.location.value,duration:+form.elements.duration.value,timezone:form.elements.timezone.value,noticeHours:+form.elements.noticeHours.value,horizonDays:+form.elements.horizonDays.value,startMinute:minutes(form.elements.start.value),endMinute:minutes(form.elements.end.value),days:[...form.querySelectorAll('[name=day]:checked')].map(c=>+c.value),enabled:form.elements.enabled.checked,bufferBefore:+form.elements.bufferBefore.value,bufferAfter:+form.elements.bufferAfter.value,maxPerDay:+form.elements.maxPerDay.value,googleMeet:form.elements.googleMeet.checked,reminders:form.elements.reminders.checked};
 try{await api(editing?'types/'+editing:'types',d,editing?'PUT':'POST');types=(await api('types')).types;render();dirty=false;close();$('#status').textContent='Page saved.';}catch(err){$('#form-error').textContent=err.message;}finally{$('#save').disabled=false;}
};
$('#new').onclick=()=>open();$('#discard').onclick=close;
addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
(async()=>{try{types=(await api('types')).types;render();await loadBookings();}catch(e){$('#status').textContent=e.message;}})();

async function loadBookings(){
 const {bookings}=await api('bookings');$('#bookings').replaceChildren();
 if(!bookings.length){$('#bookings').append(text('p','No upcoming bookings.'));return;}
 for(const b of bookings){const row=document.createElement('article');row.className='row';row.append(text('h2',b.title),text('p',new Date(b.start).toLocaleString()+' · '+b.duration+' min'),text('p',b.pending?'Update awaiting confirmation':b.status));if(b.reminderIssues)row.append(text('p','Email delivery needs attention'));const a=text('a','Manage booking ↗');a.href=b.manageUrl;a.target='_blank';a.rel='noopener';row.append(a);$('#bookings').append(row);}
}


$('#refresh-bookings').onclick=()=>loadBookings().catch(e=>{$('#status').textContent=e.message;});
}
