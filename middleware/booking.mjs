const MIN=60000,DURATION=30*MIN;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function configured(e){return !!(e.MIMORI_DB&&e.BOOKING_GOOGLE_CLIENT_ID&&e.BOOKING_GOOGLE_CLIENT_SECRET&&e.BOOKING_GOOGLE_REFRESH_TOKEN&&e.BOOKING_CALENDAR_ID);}
export function parts(t,zone){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(t)).map(p=>[p.type,p.value]));}
export function validSlot(t,e,now=Date.now()){
 if(!Number.isFinite(t)||t<now+1440*MIN||t>now+30*1440*MIN)return false;
 const p=parts(t,e.BOOKING_TIMEZONE||'America/New_York');
 return !['Sat','Sun'].includes(p.weekday)&&+p.hour>=13&&+p.hour<17&&['00','30'].includes(p.minute)&&t%MIN===0;
}
export function candidates(day,zone,e,now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return [];
 const base=Date.parse(day+'T00:00:00Z'),out=[];
 for(let t=base-840*MIN;t<base+2280*MIN;t+=30*MIN){const p=parts(t,zone);if(p.year+'-'+p.month+'-'+p.day===day&&validSlot(t,e,now))out.push(t);}
 return out;
}
async function google(e,path,body,method='POST'){
 const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:e.BOOKING_GOOGLE_CLIENT_ID,client_secret:e.BOOKING_GOOGLE_CLIENT_SECRET,refresh_token:e.BOOKING_GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})});
 if(!auth.ok)throw Error('Calendar authentication failed');
 const {access_token}=await auth.json();
 const r=await fetch('https://www.googleapis.com/calendar/v3/'+path,{method,headers:{Authorization:'Bearer '+access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok&&!(method==='DELETE'&&[404,410].includes(r.status)))throw Error('Calendar request failed');
 return method==='DELETE'?{}:r.json();
}
async function busy(e,min,max){
 const r=await google(e,'freeBusy',{timeMin:new Date(min).toISOString(),timeMax:new Date(max).toISOString(),items:[{id:e.BOOKING_CALENDAR_ID}]});
 const c=r.calendars?.[e.BOOKING_CALENDAR_ID];if(!c||c.errors)throw Error('Availability unavailable');return c.busy||[];
}
export async function bookingMiddleware(request,e,next){
 const u=new URL(request.url);if(!u.pathname.startsWith('/api/booking/'))return next();
 try{
 if(u.pathname==='/api/booking/config'&&request.method==='GET')return json({ready:configured(e),duration:30,hostTimezone:e.BOOKING_TIMEZONE||'America/New_York'});
 if(!configured(e))return json({error:'Booking is not open yet. Please check back soon.'},503);
 if(request.method==='POST'&&request.headers.get('Origin')!==u.origin)return json({error:'Invalid origin'},403);
 const db=e.MIMORI_DB;
 if(u.pathname==='/api/booking/slots'&&request.method==='GET'){
 const zone=u.searchParams.get('timezone')||'UTC';try{parts(Date.now(),zone);}catch{return json({error:'Invalid timezone'},400);}
 const slots=candidates(u.searchParams.get('date')||'',zone,e);if(!slots.length)return json({slots:[]});
 const blocks=await busy(e,slots[0],slots.at(-1)+DURATION);
 const {results}=await db.prepare("SELECT start_ms FROM booking_reservations WHERE start_ms>=? AND start_ms<=? AND status!='cancelled'").bind(slots[0],slots.at(-1)).all();
 return json({slots:slots.filter(t=>!results.some(r=>r.start_ms===t)&&!blocks.some(b=>t<Date.parse(b.end)&&t+DURATION>Date.parse(b.start))).map(t=>new Date(t).toISOString())});
 }
 if(u.pathname==='/api/booking/reserve'&&request.method==='POST'){
 const raw=await request.text();if(raw.length>4096)return json({error:'Request too large'},413);let d;try{d=JSON.parse(raw);}catch{return json({error:'Invalid request'},400);}
 const t=Date.parse(d.start),name=String(d.name||'').trim(),email=String(d.email||'').trim(),notes=String(d.notes||'').trim();
 if(!validSlot(t,e)||!name||name.length>100||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||notes.length>1000||d.website)return json({error:'Please enter valid booking details.'},400);
 const blocks=await busy(e,t,t+DURATION);if(blocks.some(b=>t<Date.parse(b.end)&&t+DURATION>Date.parse(b.start)))return json({error:'That time is no longer available.'},409);
 const token=crypto.randomUUID()+crypto.randomUUID(),id=crypto.randomUUID().replaceAll('-','');
 try{await db.prepare("INSERT INTO booking_reservations(id,start_ms,status,cancel_token,created_ms) VALUES(?,?,'pending',?,?)").bind(id,t,token,Date.now()).run();}catch(err){if(String(err).includes('UNIQUE'))return json({error:'That time was just taken. Choose another slot.'},409);throw err;}
 // Keep ambiguous failures reserved until reconciled; never risk duplicate invitations.
 try{
 await google(e,'calendars/'+encodeURIComponent(e.BOOKING_CALENDAR_ID)+'/events?sendUpdates=all',{id,summary:'Soham / '+name,description:notes,start:{dateTime:new Date(t).toISOString()},end:{dateTime:new Date(t+DURATION).toISOString()},attendees:[{email}],extendedProperties:{private:{bookingId:id}}});
 await db.prepare("UPDATE booking_reservations SET status='confirmed' WHERE id=?").bind(id).run();
 return json({start:new Date(t).toISOString(),duration:30,cancelToken:token},201);
 }catch{return json({error:'We could not confirm the invitation. Please contact Soham before trying again.'},502);}
 }
 if(u.pathname==='/api/booking/cancel'&&request.method==='POST'){
 const raw=await request.text();if(raw.length>512)return json({error:'Invalid request'},400);let d;try{d=JSON.parse(raw);}catch{return json({error:'Invalid request'},400);}
 const row=await db.prepare('SELECT id,status FROM booking_reservations WHERE cancel_token=?').bind(String(d.token||'')).first();if(!row)return json({error:'Booking not found'},404);
 if(row.status!=='cancelled'){await google(e,'calendars/'+encodeURIComponent(e.BOOKING_CALENDAR_ID)+'/events/'+row.id+'?sendUpdates=all',null,'DELETE');await db.prepare("UPDATE booking_reservations SET status='cancelled' WHERE id=?").bind(row.id).run();}
 return json({cancelled:true});
 }
 return json({error:'Not found'},404);
 }catch{return json({error:'Calendar unavailable. Please try again later.'},503);}
}
