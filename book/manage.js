const $=s=>document.querySelector(s);
const token=new URLSearchParams(location.hash.slice(1)).get('token')||new URLSearchParams(location.hash.slice(1)).get('cancel');
let zone=Intl.DateTimeFormat().resolvedOptions().timeZone,selected='',requestId=0;
const full=t=>new Intl.DateTimeFormat('en-US',{timeZone:zone,dateStyle:'full',timeStyle:'short'}).format(new Date(t))+' · '+zone;
const time=t=>new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(t));
for(const z of [...new Set([zone,'America/New_York',...(Intl.supportedValuesOf?.('timeZone')||[]),'UTC'])]){const o=document.createElement('option');o.value=z;o.textContent=z.replaceAll('_',' ');$('#timezone').append(o);}
async function api(path,data={}){const r=await fetch('/api/booking/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...data})});const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to update booking.');return d;}
function reset(){requestId++;$('#booking').hidden=false;$('#reschedule-form').hidden=true;$('#confirm-cancel').hidden=true;$('#confirm-reschedule').hidden=true;selected='';}
async function load(message=''){
 try{const b=await api('manage');reset();$('#title').textContent=b.title;$('#when').textContent=full(b.start);$('#location').textContent=b.location;$('#booking-status').textContent=b.status==='cancelled'?'Cancelled':'Confirmed · '+b.duration+' minutes';$('#reschedule').hidden=!b.canReschedule;$('#cancel').hidden=!b.canCancel;$('#message').textContent=message||(b.status==='cancelled'?'This booking has been cancelled.':'Use this private page to change or cancel your booking.');}
 catch(e){$('#booking').hidden=true;$('#message').textContent=e.message;}
}
async function slots(){
 const id=++requestId;selected='';$('#confirm-reschedule').hidden=true;$('#slots').replaceChildren();if(!$('#date').value)return;
 $('#availability').textContent='Checking availability…';
 try{const d=await api('manage/slots',{date:$('#date').value,timezone:zone});if(id!==requestId)return;$('#availability').textContent=d.slots.length?'Choose a new time.':'No available times on this date.';
 for(const t of d.slots){const b=document.createElement('button');b.textContent=time(t);b.onclick=()=>{selected=t;$('#new-time').textContent=full(t);$('#confirm-reschedule').hidden=false;};$('#slots').append(b);}}
 catch(e){if(id===requestId)$('#availability').textContent=e.message;}
}
$('#reschedule').onclick=()=>{$('#booking').hidden=true;$('#reschedule-form').hidden=false;$('#message').textContent='Your current booking stays reserved until the new time is confirmed.';};
$('#date').onchange=slots;$('#timezone').onchange=()=>{zone=$('#timezone').value;slots();};$('#back').onclick=()=>load();
$('#save-time').onclick=async()=>{if(!selected)return;$('#save-time').disabled=true;try{await api('reschedule',{start:selected});await load('Booking rescheduled. An updated calendar invitation has been emailed to everyone invited.');}catch(e){$('#message').textContent=e.message;}finally{$('#save-time').disabled=false;}};
$('#cancel').onclick=()=>{$('#booking').hidden=true;$('#confirm-cancel').hidden=false;};$('#keep').onclick=()=>load();
$('#cancel-confirm').onclick=async()=>{$('#cancel-confirm').disabled=true;try{await api('cancel');await load('Booking cancelled. Everyone invited has been notified.');}catch(e){$('#message').textContent=e.message;}finally{$('#cancel-confirm').disabled=false;}};
if(token)load();else $('#message').textContent='Open the private reschedule/cancel link in your calendar invitation.';
