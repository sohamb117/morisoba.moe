import {json,body,HttpError,adminApi,adminSession,typeView,throttle} from './booking-admin.mjs';
import {digest} from './mimori-crypto.mjs';
const MIN=60000;
export function configured(e){return !!(e.MIMORI_DB&&e.BOOKING_GOOGLE_CLIENT_ID&&e.BOOKING_GOOGLE_CLIENT_SECRET&&e.BOOKING_GOOGLE_REFRESH_TOKEN&&e.BOOKING_CALENDAR_ID);}
export function parts(t,zone){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(t)).map(p=>[p.type,p.value]));}
const defaultType=e=>({slug:'default',title:'Book a time',description:'',location:'',duration:30,timezone:e.BOOKING_TIMEZONE||'America/New_York',days:[1,2,3,4,5],startMinute:780,endMinute:1020,noticeHours:24,horizonDays:30,enabled:true});
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
async function google(e,path,data,method='POST'){
 const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:e.BOOKING_GOOGLE_CLIENT_ID,client_secret:e.BOOKING_GOOGLE_CLIENT_SECRET,refresh_token:e.BOOKING_GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})});
 if(!auth.ok)throw Error('Calendar authentication failed');
 const {access_token}=await auth.json();
 const r=await fetch('https://www.googleapis.com/calendar/v3/'+path,{method,headers:{Authorization:'Bearer '+access_token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 if(!r.ok&&!(method==='DELETE'&&[404,410].includes(r.status)))throw Error('Calendar request failed');
 return method==='DELETE'?{}:r.json();
}
async function busy(e,min,max){
 const r=await google(e,'freeBusy',{timeMin:new Date(min).toISOString(),timeMax:new Date(max).toISOString(),items:[{id:e.BOOKING_CALENDAR_ID}]});
 const c=r.calendars?.[e.BOOKING_CALENDAR_ID];if(!c||c.errors)throw Error('Availability unavailable');return c.busy||[];
}
async function getType(e,slug){if(slug==='default')return defaultType(e);if(!e.MIMORI_DB)return null;return typeView(await e.MIMORI_DB.prepare('SELECT slug,settings,enabled FROM booking_types WHERE slug=? AND enabled=1').bind(slug).first());}
function secure(response){
 const r=new Response(response.body,response);
 r.headers.set('Cache-Control','no-store');
 r.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Content-Type-Options','nosniff');
 return r;
}
export async function bookingMiddleware(request,e,next){
 const u=new URL(request.url),calendarHost=u.hostname===(e.BOOKING_HOST||'calendar.morisoba.moe'),api=u.pathname.startsWith('/api/booking/');
 try{
 if(!api){
 if(calendarHost){
 if(u.pathname==='/')return Response.redirect(u.origin+'/admin/',302);
 if(u.pathname==='/admin')return Response.redirect(u.origin+'/admin/',302);
 if(u.pathname==='/admin/'||u.pathname==='/admin/login'){
 const signed=await adminSession(request,e),asset=signed?'/book/admin/index.html':'/book/admin/login.html';
 return secure(await e.ASSETS.fetch(new Request(new URL(asset,u),request)));
 }
 if(u.pathname.startsWith('/shared/')||['/book/app.js','/book/style.css','/book/admin/app.js','/book/admin/login.js','/book/admin/style.css'].includes(u.pathname))return e.ASSETS.fetch(request);
 const m=/^\/([a-z][a-z0-9_-]{0,63})\/?$/.exec(u.pathname);
 if(m){const t=await getType(e,m[1]);if(t)return secure(await e.ASSETS.fetch(new Request(new URL('/book/index.html',u),request)));}
 return new Response('Booking page not found',{status:404});
 }
 // Portal also works on the main site before the custom domain is attached.
 if(u.pathname==='/book/admin/'||u.pathname==='/book/admin/login'){
 const signed=await adminSession(request,e);
 return secure(await e.ASSETS.fetch(new Request(new URL(signed?'/book/admin/index.html':'/book/admin/login.html',u),request)));
 }
 if(u.pathname.startsWith('/book/admin/')&&!/\.(js|css)$/.test(u.pathname))return new Response('Not found',{status:404});
 return next();
 }
 if(u.pathname.startsWith('/api/booking/admin/'))return await adminApi(request,e);
 if(request.method==='POST'&&request.headers.get('Origin')!==u.origin)return json({error:'Invalid origin'},403);
 if(u.pathname==='/api/booking/cancel'&&request.method==='POST'){
 if(!configured(e))return json({error:'Calendar unavailable'},503);
 const d=await body(request,512),row=await e.MIMORI_DB.prepare('SELECT id,status,calendar_id FROM booking_reservations WHERE cancel_token=?').bind(String(d.token||'')).first();
 if(!row)return json({error:'Booking not found'},404);
 if(row.status!=='cancelled'){
 await google(e,'calendars/'+encodeURIComponent(row.calendar_id||e.BOOKING_CALENDAR_ID)+'/events/'+row.id+'?sendUpdates=all',null,'DELETE');
 await e.MIMORI_DB.batch([e.MIMORI_DB.prepare("UPDATE booking_reservations SET status='cancelled' WHERE id=?").bind(row.id),e.MIMORI_DB.prepare('DELETE FROM booking_slot_locks WHERE reservation_id=?').bind(row.id)]);
 }
 return json({cancelled:true});
 }
 const d=request.method==='POST'?await body(request,4096):null,slug=d?.slug||u.searchParams.get('slug')||'default',type=await getType(e,slug);
 if(!type)return json({error:'Booking page not found'},404);
 if(u.pathname==='/api/booking/config'&&request.method==='GET')return json({ready:configured(e),...type,hostTimezone:type.timezone});
 if(!configured(e))return json({error:'Bookings are not open yet.'},503);
 const db=e.MIMORI_DB,duration=type.duration*MIN;
 if(u.pathname==='/api/booking/slots'&&request.method==='GET'){
 const zone=u.searchParams.get('timezone')||'UTC';try{parts(Date.now(),zone);}catch{return json({error:'Invalid timezone'},400);}
 const slots=candidates(u.searchParams.get('date')||'',zone,e,Date.now(),type);if(!slots.length)return json({slots:[]});
 const blocks=await busy(e,slots[0],slots.at(-1)+duration);
 const {results}=await db.prepare('SELECT start_ms FROM booking_slot_locks WHERE start_ms>=? AND start_ms<?').bind(slots[0],slots.at(-1)+duration).all();
 return json({slots:slots.filter(t=>!results.some(r=>r.start_ms>=t&&r.start_ms<t+duration)&&!blocks.some(b=>t<Date.parse(b.end)&&t+duration>Date.parse(b.start))).map(t=>new Date(t).toISOString())});
 }
 if(u.pathname==='/api/booking/reserve'&&request.method==='POST'){
 await throttle(db,'reserve:'+digest(request.headers.get('CF-Connecting-IP')||'unknown'),5);
 const t=Date.parse(d.start),name=String(d.name||'').trim(),email=String(d.email||'').trim(),notes=String(d.notes||'').trim();
 if(!validSlot(t,e,Date.now(),type)||!name||name.length>100||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||notes.length>1000||d.website)return json({error:'Please enter valid booking details.'},400);
 const blocks=await busy(e,t,t+duration);if(blocks.some(b=>t<Date.parse(b.end)&&t+duration>Date.parse(b.start)))return json({error:'That time is no longer available.'},409);
 const cancelToken=crypto.randomUUID()+crypto.randomUUID(),id=crypto.randomUUID().replaceAll('-','');
 const statements=[db.prepare("INSERT INTO booking_reservations(id,start_ms,status,cancel_token,created_ms,booking_slug,duration_minutes,calendar_id) VALUES(?,?,'pending',?,?,?,?,?)").bind(id,t,cancelToken,Date.now(),slug,type.duration,e.BOOKING_CALENDAR_ID)];
 for(let lock=t;lock<t+duration;lock+=15*MIN)statements.push(db.prepare('INSERT INTO booking_slot_locks(start_ms,reservation_id) VALUES(?,?)').bind(lock,id));
 try{await db.batch(statements);}catch(err){if(/UNIQUE|constraint/i.test(String(err)))return json({error:'That time was just taken. Choose another slot.'},409);throw err;}
 try{
 await google(e,'calendars/'+encodeURIComponent(e.BOOKING_CALENDAR_ID)+'/events?sendUpdates=all',{id,summary:type.title+' / '+name,description:notes,...(type.location?{location:type.location}:{}),start:{dateTime:new Date(t).toISOString()},end:{dateTime:new Date(t+duration).toISOString()},attendees:[{email}],extendedProperties:{private:{bookingId:id,bookingType:slug}}});
 await db.prepare("UPDATE booking_reservations SET status='confirmed' WHERE id=?").bind(id).run();
 return json({start:new Date(t).toISOString(),duration:type.duration,title:type.title,cancelToken},201);
 }catch{return json({error:'Could not confirm the invitation. Please contact Soham before trying again.'},502);}
 }
 return json({error:'Not found'},404);
 }catch(err){return json({error:err instanceof HttpError?err.message:'Calendar unavailable. Please try again later.'},err instanceof HttpError?err.status:503);}
}
