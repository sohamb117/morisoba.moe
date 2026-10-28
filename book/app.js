const $=s=>document.querySelector(s);
let zone=Intl.DateTimeFormat().resolvedOptions().timeZone,view=new Date(),selectedDay='',selectedTime='',ready=false,requestId=0,icsUrl;
view=new Date(view.getFullYear(),view.getMonth(),1);
const zones=[...new Set([zone,'America/New_York','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Kolkata','Asia/Tokyo','Australia/Sydney','UTC'])];
for(const z of zones){const o=document.createElement('option');o.value=z;o.textContent=z.replaceAll('_',' ');$('#timezone').append(o);}$('#timezone').value=zone;
function localDay(t){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(t).map(p=>[p.type,p.value]));return p.year+'-'+p.month+'-'+p.day;}
const time=t=>new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(t));
const full=t=>new Intl.DateTimeFormat('en-US',{timeZone:zone,dateStyle:'full',timeStyle:'short'}).format(new Date(t))+' · '+zone;
function calendar(){
 $('#month').textContent=view.toLocaleDateString('en-US',{month:'long',year:'numeric'});$('#days').replaceChildren();
 const offset=(view.getDay()+6)%7;for(let i=0;i<offset;i++)$('#days').append(document.createElement('span'));
 for(let d=1;d<=new Date(view.getFullYear(),view.getMonth()+1,0).getDate();d++){
 const day=view.getFullYear()+'-'+String(view.getMonth()+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'),b=document.createElement('button');b.textContent=d;b.type='button';b.disabled=day<localDay(new Date())||day>localDay(new Date(Date.now()+30*86400000));b.classList.toggle('selected',selectedDay===day);b.classList.toggle('today',day===localDay(new Date()));b.setAttribute('aria-label',new Date(day+'T12:00:00').toLocaleDateString('en-US',{dateStyle:'full'}));b.setAttribute('aria-pressed',selectedDay===day);b.onclick=()=>{selectedDay=day;calendar();loadSlots();};$('#days').append(b);
 }
 const current=new Date();$('#prev').disabled=view.getFullYear()===current.getFullYear()&&view.getMonth()===current.getMonth();$('#next').disabled=view.getTime()>Date.now()+30*86400000;
}
async function api(path,body){const r=await fetch('/api/booking/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});let d;try{d=await r.json();}catch{throw Error('Calendar connection unavailable. Please try again later.');}if(!r.ok)throw Error(d.error||'Request failed');return d;}
async function loadSlots(){
 const id=++requestId;$('#slots').replaceChildren();$('#date-label').textContent=new Date(selectedDay+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric'});if(!ready){$('#status').textContent='Booking is not open yet. Calendar connection is being configured.';return;}
 $('#status').textContent='Checking the calendar…';
 try{const {slots}=await api('slots?date='+selectedDay+'&timezone='+encodeURIComponent(zone));if(id!==requestId)return;$('#status').textContent=slots.length?'All times shown in your timezone.':'No open times on this date. Try another day.';
 for(const t of slots){const b=document.createElement('button');b.textContent=time(t);b.onclick=()=>{selectedTime=t;$('#picker').hidden=true;$('#details').hidden=false;$('#selection').textContent=full(t);$('#step').textContent='YOUR DETAILS';$('#details input').focus();};$('#slots').append(b);}
 }catch(e){if(id===requestId)$('#status').textContent=e.message;}
}
$('#prev').onclick=()=>{view.setMonth(view.getMonth()-1);calendar();};$('#next').onclick=()=>{view.setMonth(view.getMonth()+1);calendar();};
$('#timezone').onchange=()=>{zone=$('#timezone').value;calendar();if(selectedDay)loadSlots();};$('#back').onclick=()=>{$('#picker').hidden=false;$('#details').hidden=true;$('#step').textContent='SELECT DATE';loadSlots();};
function cancellationUrl(token){return location.origin+location.pathname+'#cancel='+encodeURIComponent(token);}
async function cancel(token,target,button){button.disabled=true;try{await api('cancel',{token});target.textContent='Booking cancelled. The calendar has been updated.';}catch(e){target.textContent=e.message;button.disabled=false;}}
$('#details').onsubmit=async e=>{
 e.preventDefault();$('#submit').disabled=true;$('#form-error').textContent='';
 try{
 const body=Object.fromEntries(new FormData(e.target));body.start=selectedTime;const booking=await api('reserve',body);
 $('#details').hidden=true;$('#complete').hidden=false;$('#step').textContent='CONFIRMED';$('#confirmed-time').textContent=full(booking.start);
 $('#cancel-link').href=cancellationUrl(booking.cancelToken);$('#cancel-link').target='_blank';$('#cancel-link').rel='noopener';
 $('#cancel-now').onclick=()=>{if(confirm('Cancel this booking?'))cancel(booking.cancelToken,$('#cancel-status'),$('#cancel-now'));};
 const stamp=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//morisoba.moe//Booking//EN','BEGIN:VEVENT','UID:'+crypto.randomUUID()+'@morisoba.moe','DTSTAMP:'+stamp(Date.now()),'DTSTART:'+stamp(booking.start),'DTEND:'+stamp(Date.parse(booking.start)+1800000),'SUMMARY:Conversation with Soham','DESCRIPTION:Cancellation link: '+cancellationUrl(booking.cancelToken),'END:VEVENT','END:VCALENDAR',''].join('\r\n');
 if(icsUrl)URL.revokeObjectURL(icsUrl);icsUrl=URL.createObjectURL(new Blob([text],{type:'text/calendar'}));$('#download').href=icsUrl;$('#download').download='conversation.ics';
 }catch(err){$('#form-error').textContent=err.message;}finally{$('#submit').disabled=false;}
};
const token=new URLSearchParams(location.hash.slice(1)).get('cancel');if(token){$('#picker').hidden=true;$('#cancel-view').hidden=false;$('#step').textContent='MANAGE BOOKING';$('#cancel-confirm').onclick=()=>cancel(token,$('#cancel-result'),$('#cancel-confirm'));}
calendar();
$('#clock').textContent=new Date().toUTCString();
api('config').then(c=>{ready=c.ready;$('#status').textContent=ready?'Choose a date to see available times.':'Booking is not open yet. Calendar connection is being configured.';}).catch(e=>{$('#status').textContent=e.message;});
