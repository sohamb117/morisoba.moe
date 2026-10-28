import {bookingEmail,emailKey,abuseLimit,requestBookingCode,checkBookingCode} from './booking-verification.mjs';
import {notifyBookingHost} from './booking-notifications.mjs';
import {google,configured} from './booking-google.mjs';
export {configured} from './booking-google.mjs';
import {manageBooking} from './booking-manage.mjs';
import {json,body,HttpError,adminApi,adminSession,typeView,throttle,validOrigin} from './booking-admin.mjs';
import {digest} from './mimori-crypto.mjs';
const MIN=60000;
const formatters=new Map();
export function parts(t,zone){
 let formatter=formatters.get(zone);
 if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'});if(formatters.size>=32)formatters.delete(formatters.keys().next().value);formatters.set(zone,formatter);}
 return Object.fromEntries(formatter.formatToParts(new Date(t)).map(p=>[p.type,p.value]));
}
const defaultType=e=>({slug:'default',title:'Book a time',description:'',location:'',duration:30,timezone:e.BOOKING_TIMEZONE||'America/New_York',days:[1,2,3,4,5],startMinute:780,endMinute:1020,noticeHours:24,horizonDays:30,enabled:true,bufferBefore:0,bufferAfter:0,maxPerDay:0,googleMeet:true,reminders:true});
export function validSlot(t,e,now=Date.now(),type=defaultType(e)){
 if(!Number.isFinite(t)||t<now+type.noticeHours*60*MIN||t>now+type.horizonDays*1440*MIN||t%(15*MIN)!==0)return false;
 const p=parts(t,type.timezone),weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday),minute=+p.hour*60+(+p.minute);
 if(!type.days.includes(weekday)||minute<type.startMinute||minute+type.duration>type.endMinute)return false;
 // No bookings across a DST jump or repeated hour inside a meeting.
 const end=parts(t+type.duration*MIN-1,type.timezone);
 return p.year===end.year&&p.month===end.month&&p.day===end.day&&+end.hour*60+(+end.minute)===minute+type.duration-1;
}
export function candidates(day,zone,e,now=Date.now(),type=defaultType(e)){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return [];
 const base=Date.parse(day+'T00:00:00Z'),out=[];
 for(let t=base-840*MIN;t<base+2280*MIN;t+=15*MIN){const p=parts(t,zone);if(p.year+'-'+p.month+'-'+p.day===day&&validSlot(t,e,now,type))out.push(t);}
 return out;
}
async function busy(e,min,max){
 const r=await google(e,'freeBusy',{timeMin:new Date(min).toISOString(),timeMax:new Date(max).toISOString(),items:[{id:e.BOOKING_CALENDAR_ID}]});
 const c=r.calendars?.[e.BOOKING_CALENDAR_ID];if(!c||c.errors)throw Error('Availability unavailable');return c.busy||[];
}
export const bookingDay=(t,zone)=>{const p=parts(t,zone);return p.year+'-'+p.month+'-'+p.day;};
async function getType(e,slug){if(slug==='default')return defaultType(e);if(!e.MIMORI_DB)return null;return typeView(await e.MIMORI_DB.prepare('SELECT slug,settings,enabled FROM booking_types WHERE slug=? AND enabled=1').bind(slug).first());}
function secure(response){
 const r=new Response(response.body,response);
 r.headers.set('Cache-Control','no-store');
 r.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Content-Type-Options','nosniff');
 return r;
}
async function handleBooking(request,e,next){
 const u=new URL(request.url),calendarHost=u.hostname===(e.BOOKING_HOST||'calendar.morisoba.moe'),api=u.pathname.startsWith('/api/booking/');
 try{
 if(!api){
 if(calendarHost){
 if(u.pathname==='/')return Response.redirect(u.origin+'/30min',302);
 if(u.pathname==='/admin')return Response.redirect(u.origin+'/admin/',302);
 if(u.pathname==='/admin/'||u.pathname==='/admin/login'||u.pathname==='/admin/login.html'){
 const signed=await adminSession(request,e),asset=signed?'/book/admin/':'/book/admin/login';
 return secure(await e.ASSETS.fetch(new Request(new URL(asset,u),request)));
 }
 if(u.pathname==='/privacy')return secure(await e.ASSETS.fetch(new Request(new URL('/book/privacy',u),request)));
 if(u.pathname==='/manage'||u.pathname==='/manage/')return secure(await e.ASSETS.fetch(new Request(new URL('/book/manage',u),request)));
 if(u.pathname.startsWith('/shared/')||['/book/manage.js','/book/app.js','/book/style.css','/book/admin/app.js','/book/admin/login.js','/book/admin/style.css'].includes(u.pathname))return e.ASSETS.fetch(request);
 const m=/^\/([a-z0-9][a-z0-9_-]{0,63})\/?$/.exec(u.pathname);
 if(m){const t=await getType(e,m[1]);if(t)return secure(await e.ASSETS.fetch(new Request(new URL('/book/',u),request)));}
 return new Response('Booking page not found',{status:404});
 }
 // Portal also works on the main site before the custom domain is attached.
 if(u.pathname==='/book/admin/'||u.pathname==='/book/admin/login'||u.pathname==='/book/admin/login.html'){
 const signed=await adminSession(request,e);
 return secure(await e.ASSETS.fetch(new Request(new URL(signed?'/book/admin/':'/book/admin/login',u),request)));
 }
 if(u.pathname.startsWith('/book/admin/')&&!/\.(js|css)$/.test(u.pathname))return new Response('Not found',{status:404});
 return next();
 }
 if(u.pathname==='/api/booking/admin/calendar'&&request.method==='GET'){
 if(!await adminSession(request,e))return json({error:'Sign in required'},401);
 if(!configured(e))return json({connected:false,message:'Google Calendar is not connected.'});
 try{await busy(e,Date.now(),Date.now()+MIN);return json({connected:true,calendar:e.BOOKING_CALENDAR_ID,message:'Google Calendar connected. Invitations, updates and cancellations are emailed automatically.'});}catch{return json({connected:false,message:'Google Calendar authorization needs attention. Availability and new bookings are unavailable.'});}
 }
 if(u.pathname.startsWith('/api/booking/admin/'))return await adminApi(request,e);
 if(request.method==='POST'&&!validOrigin(request,e))return json({error:'Invalid origin'},403);
 if(['/api/booking/manage','/api/booking/manage/slots','/api/booking/cancel','/api/booking/reschedule'].includes(u.pathname))return await manageBooking(request,e,{google,getType,candidates,validSlot,configured,bookingDay});
 const d=request.method==='POST'?await body(request,4096):null,slug=d?.slug||u.searchParams.get('slug')||'default',type=await getType(e,slug);
 if(!type)return json({error:'Booking page not found'},404);
 if(u.pathname==='/api/booking/config'&&request.method==='GET')return json({ready:configured(e),...type,hostTimezone:type.timezone});
 if(!configured(e))return json({error:'Bookings are not open yet.'},503);
 const db=e.MIMORI_DB,duration=type.duration*MIN,before=(type.bufferBefore||0)*MIN,after=(type.bufferAfter||0)*MIN;
 if(u.pathname==='/api/booking/verify'&&request.method==='POST')return await requestBookingCode(request,e,d);
 if(['/api/booking/slots','/api/booking/days'].includes(u.pathname)&&request.method==='GET'){
 await abuseLimit(db,'availability:'+digest(request.headers.get('CF-Connecting-IP')||'unknown'),60,300000);
 const zone=u.searchParams.get('timezone')||'UTC';try{parts(Date.now(),zone);}catch{return json({error:'Invalid timezone'},400);}
 const monthView=u.pathname.endsWith('/days'),month=u.searchParams.get('month')||'',now=Date.now();
 let slots=[];
 if(monthView){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return json({error:'Invalid month'},400);
  const base=Date.parse(month+'-01T00:00:00Z'),end=Date.UTC(+month.slice(0,4),+month.slice(5),1);
  if(end<now-86400000||base>now+(type.horizonDays+2)*86400000)return json({days:[]});
  for(let t=Math.max(base-840*MIN,Math.ceil((now+type.noticeHours*60*MIN)/(15*MIN))*15*MIN);t<Math.min(end+840*MIN,now+type.horizonDays*86400000);t+=15*MIN){
   if(bookingDay(t,zone).startsWith(month)&&validSlot(t,e,now,type))slots.push(t);
  }
 }else slots=candidates(u.searchParams.get('date')||'',zone,e,now,type);
 if(!slots.length)return json(monthView?{days:[]}:{slots:[]});
 const blocks=await busy(e,slots[0]-before,slots.at(-1)+duration+after);
 const {results}=await db.prepare('SELECT start_ms FROM booking_slot_locks WHERE start_ms>=? AND start_ms<?').bind(slots[0]-before,slots.at(-1)+duration+after).all();
 const counts=type.maxPerDay?(await db.prepare('SELECT booking_day,count(*) AS n FROM booking_day_usage WHERE booking_slug=? GROUP BY booking_day').bind(slug).all()).results:[];
 const available=slots.filter(t=>!counts.some(c=>c.booking_day===bookingDay(t,type.timezone)&&c.n>=type.maxPerDay)&&!results.some(r=>r.start_ms>=t-before&&r.start_ms<t+duration+after)&&!blocks.some(b=>t-before<Date.parse(b.end)&&t+duration+after>Date.parse(b.start)));
 return json(monthView?{days:[...new Set(available.map(t=>bookingDay(t,zone)))]}:{slots:available.map(t=>new Date(t).toISOString())});
 }
 if(u.pathname==='/api/booking/reserve'&&request.method==='POST'){
 await throttle(db,'reserve:'+digest(request.headers.get('CF-Connecting-IP')||'unknown'),5);
 const t=Date.parse(d.start),name=String(d.name||'').trim(),email=bookingEmail(d.email),notes=String(d.notes||'').trim();
 if(!validSlot(t,e,Date.now(),type)||!name||name.length>100||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||notes.length>1000||d.website)return json({error:'Please enter valid booking details.'},400);
 await checkBookingCode(db,d,email);
 const emailHash=emailKey(email);
 const blocks=await busy(e,t-before,t+duration+after);if(blocks.some(b=>t-before<Date.parse(b.end)&&t+duration+after>Date.parse(b.start)))return json({error:'That time is no longer available.'},409);
 const cancelToken=crypto.randomUUID()+crypto.randomUUID(),id=crypto.randomUUID().replaceAll('-','');
 const day=bookingDay(t,type.timezone),max=type.maxPerDay||1000000;
 const statements=[db.prepare("INSERT INTO booking_reservations(id,start_ms,status,cancel_token,created_ms,booking_slug,duration_minutes,calendar_id,buffer_before,buffer_after,booking_day,reminders,email_key) SELECT ?,?,'pending',?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM booking_day_usage WHERE booking_slug=? AND booking_day=?)<? AND (SELECT count(*) FROM booking_reservations WHERE email_key=? AND status!='cancelled' AND start_ms>?)<2 AND (SELECT count(*) FROM booking_reservations WHERE email_key=? AND created_ms>?)<3 AND (SELECT count(*) FROM booking_reservations WHERE created_ms>?)<20 AND EXISTS(SELECT 1 FROM booking_verifications WHERE id=? AND email_hash=? AND expires_ms>? AND consumed_ms IS NULL AND attempts<=5) RETURNING id").bind(id,t,cancelToken,Date.now(),slug,type.duration,e.BOOKING_CALENDAR_ID,type.bufferBefore||0,type.bufferAfter||0,day,+!!type.reminders,emailHash,slug,day,max,emailHash,Date.now(),emailHash,Date.now()-86400000,Date.now()-86400000,d.verificationId,digest(email),Date.now())];
 statements.push(db.prepare('UPDATE booking_verifications SET consumed_ms=? WHERE id=? AND EXISTS(SELECT 1 FROM booking_reservations WHERE id=?)').bind(Date.now(),d.verificationId,id));
 for(let lock=t-before;lock<t+duration+after;lock+=15*MIN)statements.push(db.prepare('INSERT INTO booking_slot_locks(start_ms,reservation_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM booking_reservations WHERE id=?)').bind(lock,id,id));
 try{const result=await db.batch(statements);if(!result[0].results.length)return json({error:'A booking limit has been reached or this code was already used. Each address may have two upcoming bookings and make three bookings per day.'},409);}catch(err){if(/UNIQUE|constraint/i.test(String(err)))return json({error:'That time was just taken. Choose another slot.'},409);throw err;}
 try{
 const event=await google(e,'calendars/'+encodeURIComponent(e.BOOKING_CALENDAR_ID)+'/events?sendUpdates=all&conferenceDataVersion=1',{id,...(type.googleMeet?{conferenceData:{createRequest:{requestId:id,conferenceSolutionKey:{type:'hangoutsMeet'}}}}:{}),summary:type.title+' / '+name,description:[notes,'Reschedule or cancel: https://'+(e.BOOKING_HOST||'calendar.morisoba.moe')+'/manage#token='+cancelToken].filter(Boolean).join('\n\n'),guestsCanInviteOthers:false,guestsCanModify:false,...(type.location?{location:type.location}:{}),start:{dateTime:new Date(t).toISOString()},end:{dateTime:new Date(t+duration).toISOString()},attendees:[{email}],extendedProperties:{private:{bookingId:id,bookingType:slug}}});
 await db.prepare("UPDATE booking_reservations SET status='confirmed' WHERE id=?").bind(id).run();
 await notifyBookingHost(e,{event,start:t,timezone:type.timezone,cancelToken,name,email,notes});
 return json({start:new Date(t).toISOString(),duration:type.duration,title:type.title,cancelToken,eventId:id,eventUid:event.iCalUID||id+'@google.com',meetingUrl:event.hangoutLink||event.conferenceData?.entryPoints?.find(p=>p.entryPointType==='video')?.uri||null},201);
 }catch{return json({error:'Could not confirm the invitation. Please contact Soham before trying again.'},502);}
 }
 return json({error:'Not found'},404);
 }catch(err){return json({error:err instanceof HttpError?err.message:'Calendar unavailable. Please try again later.'},err instanceof HttpError?err.status:503);}
}

export async function bookingMiddleware(request,e,next){
 const u=new URL(request.url);
 if(u.pathname.startsWith('/api/booking/')&&request.headers.has('Origin')&&!validOrigin(request,e))return json({error:'Invalid origin'},403);
 return handleBooking(request,e,next);
}
