const $=s=>document.querySelector(s);
const pagePath=location.pathname.split('/').filter(Boolean),slug=new URLSearchParams(location.search).get('booking')||(pagePath.length===1&&pagePath[0]!=='book'?pagePath[0]:'default');
let bookingConfig={duration:30,horizonDays:30};
let zone=Intl.DateTimeFormat().resolvedOptions().timeZone,view=new Date(),selectedDay='',selectedTime='',ready=false,requestId=0,icsUrl;
let availableDays=null,daysRequestId=0,verificationId='';
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
 const day=view.getFullYear()+'-'+String(view.getMonth()+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'),b=document.createElement('button');b.textContent=d;b.type='button';b.disabled=!ready||(availableDays!==null&&!availableDays.has(day))||day<localDay(new Date())||day>localDay(new Date(Date.now()+bookingConfig.horizonDays*86400000));b.classList.toggle('selected',selectedDay===day);b.classList.toggle('today',day===localDay(new Date()));b.setAttribute('aria-label',new Date(day+'T12:00:00').toLocaleDateString('en-US',{dateStyle:'full'}));b.setAttribute('aria-pressed',selectedDay===day);b.onclick=()=>{selectedDay=day;calendar();loadSlots();};$('#days').append(b);
 }
 const current=new Date();$('#prev').disabled=view.getFullYear()===current.getFullYear()&&view.getMonth()===current.getMonth();$('#next').disabled=view.getTime()>Date.now()+bookingConfig.horizonDays*86400000;
}
async function api(path,body){if(body&&['reserve','verify'].includes(path))body.slug=slug;if(!body)path+=(path.includes('?')?'&':'?')+'slug='+encodeURIComponent(slug);const r=await fetch('/api/booking/'+path,body?{credentials:'include',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{credentials:'include'});let d;try{d=await r.json();}catch{throw Error('Calendar connection unavailable. Please try again later.');}if(!r.ok)throw Error(d.error||'Request failed');return d;}
async function loadDays(){
 const id=++daysRequestId;availableDays=null;calendar();
 if(!ready)return;
 $('#days').setAttribute('aria-busy','true');
 if(!selectedDay)$('#status').textContent='Checking available dates…';
 try{
  const month=view.getFullYear()+'-'+String(view.getMonth()+1).padStart(2,'0');
  const result=await api('days?month='+month+'&timezone='+encodeURIComponent(zone));
  if(id!==daysRequestId)return;
  availableDays=new Set(result.days);calendar();
  if(!selectedDay)$('#status').textContent=result.days.length?'Choose an available date. Greyed-out days have no open times.':'No open times this month. Try another month.';
 }catch(e){if(id===daysRequestId&&!selectedDay)$('#status').textContent='Could not check all dates. Select a date to try its availability.';}
 finally{if(id===daysRequestId)$('#days').removeAttribute('aria-busy');}
}
async function loadSlots(){
 const id=++requestId;$('#slots').replaceChildren();$('#date-label').textContent=new Date(selectedDay+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric'});if(!ready){$('#status').textContent='Bookings are not open yet.';return;}
 $('#status').textContent='Checking the calendar…';
 try{const {slots}=await api('slots?date='+selectedDay+'&timezone='+encodeURIComponent(zone));if(id!==requestId)return;if(!slots.length&&availableDays){availableDays.delete(selectedDay);calendar();}$('#status').textContent=slots.length?'Times are in your selected timezone.':'No open times on this date. Try another day.';
 for(const t of slots){const b=document.createElement('button');b.textContent=time(t);b.onclick=()=>{selectedTime=t;$('#picker').hidden=true;$('#details').hidden=false;$('#selection').textContent=full(t);$('#step').textContent='YOUR DETAILS';$('#details input').focus();};$('#slots').append(b);}
 }catch(e){if(id===requestId)$('#status').textContent=e.message;}
}
$('#prev').onclick=()=>{view.setMonth(view.getMonth()-1);loadDays();};$('#next').onclick=()=>{view.setMonth(view.getMonth()+1);loadDays();};
$('#timezone').onchange=()=>{zone=$('#timezone').value;loadDays();if(selectedDay)loadSlots();};$('#back').onclick=()=>{$('#picker').hidden=false;$('#details').hidden=true;$('#step').textContent='SELECT DATE';loadSlots();};
function cancellationUrl(token){return 'https://calendar.morisoba.moe/manage#token='+encodeURIComponent(token);}
async function cancel(token,target,button){button.disabled=true;try{await api('cancel',{token});target.textContent='Booking cancelled. The calendar has been updated.';}catch(e){target.textContent=e.message;button.disabled=false;}}
function resetVerification(){verificationId='';$('#verification').hidden=true;$('#details').elements.code.required=false;$('#details').elements.code.value='';$('#submit').textContent='Email me a verification code';}
$('#details').elements.email.addEventListener('input',resetVerification);
async function sendCode(){
 const form=$('#details');
 const result=await api('verify',{email:form.elements.email.value,website:form.elements.website.value});
 verificationId=result.verificationId;$('#verification').hidden=false;form.elements.code.required=true;form.elements.code.value='';
 $('#verification-status').textContent='Check your email for a 6-digit code. It expires in 10 minutes. Your time is not reserved until you confirm.';
 $('#submit').textContent='Verify email & book time';form.elements.code.focus();
}
$('#resend-code').onclick=async()=>{$('#resend-code').disabled=true;$('#submit').disabled=true;$('#form-error').textContent='';try{await sendCode();}catch(e){$('#form-error').textContent=e.message;}finally{$('#resend-code').disabled=false;$('#submit').disabled=false;}};
$('#details').onsubmit=async e=>{
 e.preventDefault();$('#submit').disabled=true;$('#form-error').textContent='';
 try{
 if(!verificationId){await sendCode();return;}
 const body=Object.fromEntries(new FormData(e.target));body.start=selectedTime;body.verificationId=verificationId;const booking=await api('reserve',body);
 $('#details').hidden=true;$('#complete').hidden=false;$('#step').textContent='CONFIRMED';$('#confirmed-time').textContent=full(booking.start);
 if(booking.meetingUrl&&new URL(booking.meetingUrl).hostname==='meet.google.com'){$('#meeting-link').href=booking.meetingUrl;$('#meeting-link').hidden=false;}
 $('#cancel-link').href=cancellationUrl(booking.cancelToken);$('#cancel-link').target='_blank';$('#cancel-link').rel='noopener';
 $('#cancel-now').onclick=()=>{if(confirm('Cancel this booking?'))cancel(booking.cancelToken,$('#cancel-status'),$('#cancel-now'));};
 const stamp=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//morisoba.moe//Booking//EN','BEGIN:VEVENT','UID:'+booking.eventUid,'DTSTAMP:'+stamp(Date.now()),'DTSTART:'+stamp(booking.start),'DTEND:'+stamp(Date.parse(booking.start)+booking.duration*60000),'SUMMARY:'+(booking.title||'Meeting with Soham').replace(/[\r\n,;]/g,' '),'DESCRIPTION:Reschedule or cancel: '+cancellationUrl(booking.cancelToken),'END:VEVENT','END:VCALENDAR',''].join('\r\n');
 if(icsUrl)URL.revokeObjectURL(icsUrl);icsUrl=URL.createObjectURL(new Blob([text],{type:'text/calendar'}));$('#download').href=icsUrl;$('#download').download='meeting.ics';
 }catch(err){$('#form-error').textContent=err.message;}finally{$('#submit').disabled=false;}
};
const token=new URLSearchParams(location.hash.slice(1)).get('cancel');if(token){location.replace(cancellationUrl(token));$('#picker').hidden=true;$('#cancel-view').hidden=false;$('#step').textContent='MANAGE BOOKING';$('#cancel-confirm').onclick=()=>cancel(token,$('#cancel-result'),$('#cancel-confirm'));}
calendar();
$('#clock').textContent=new Date().toUTCString();
api('config').then(c=>{
 bookingConfig=c;ready=c.ready;document.title=c.title+' / morisoba';$('#booking-title').textContent=c.title;
 $('#booking-description').textContent=c.description;$('#booking-description').hidden=!c.description;
 $('#booking-duration').textContent=c.duration+' minutes';$('#slot-duration').textContent=c.duration+' MIN';
 $('#booking-notice').textContent=c.noticeHours+' hours';$('#booking-location').textContent=c.location;$('#booking-location').hidden=!c.location;
 const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
 $('#booking-hours').textContent=c.days.map(d=>dayNames[d]).join(', ')+' · '+clock(c.startMinute)+'–'+clock(c.endMinute)+' · '+c.timezone;
 calendar();$('#status').textContent=ready?'Choose a date to see available times.':'Bookings are not open yet.';loadDays();
}).catch(e=>{$('#status').textContent=e.message;$('#days').querySelectorAll('button').forEach(b=>b.disabled=true);});
