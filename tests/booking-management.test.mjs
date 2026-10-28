import {digest} from '../middleware/mimori-crypto.mjs';
import {bookingEmail,emailKey} from '../middleware/booking-verification.mjs';
import {test,beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {sendBookingReminders,reminderKind,reminderMessage} from '../middleware/booking-reminders.mjs';
import {bookingMiddleware} from '../middleware/booking.mjs';
let sql,env,events,calls,failPatch,failDelete,busyBlocks,failMail;
const token='11111111-1111-1111-1111-11111111111122222222-2222-2222-2222-222222222222';
const origin='https://calendar.morisoba.moe';
function stmt(query,args=[]){return {bind(...v){return stmt(query,v);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);},query,args};}
function verified(email='guest@example.com'){
 const verificationId=crypto.randomUUID().replaceAll('-',''),code='123456';
 sql.prepare('INSERT INTO booking_verifications(id,email_hash,code_hash,expires_ms) VALUES(?,?,?,?)').run(verificationId,digest(bookingEmail(email)),digest(verificationId+':'+code),Date.now()+600000);
 return {verificationId,code};
}
async function req(path,data,headers={},autoVerify=true){if(path==='reserve'&&autoVerify)data={...data,...verified(data.email)};const r=await bookingMiddleware(new Request(origin+'/api/booking/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)}),env,()=>new Response('fallback'));return {status:r.status,data:await r.json()};}
function nextSlot(){let d=new Date(Date.now()+3*86400000);d.setUTCHours(19,0,0,0);while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()+1);return d.getTime();}
function seed(start=nextSlot()){
 sql.prepare("INSERT INTO booking_reservations(id,start_ms,status,cancel_token,created_ms,duration_minutes,calendar_id) VALUES('abc',?,'confirmed',?,?,30,'primary')").run(start,token,Date.now());
 sql.prepare("INSERT INTO booking_slot_locks VALUES(?,'abc')").run(start);sql.prepare("INSERT INTO booking_slot_locks VALUES(?,'abc')").run(start+900000);
 events.set('abc',{id:'abc',etag:'"v1"',status:'confirmed',summary:'Meeting / Guest',start:{dateTime:new Date(start).toISOString()},end:{dateTime:new Date(start+1800000).toISOString()},attendees:[{email:'guest@example.com'}]});return start;
}
beforeEach(()=>{
 sql=new DatabaseSync(':memory:');for(const n of ['0003_booking.sql','0004_booking_portal.sql','0005_booking_password.sql','0006_booking_management.sql','0007_booking_options.sql','0008_booking_verification.sql'])sql.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 env={MIMORI_DB:{prepare:stmt,async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>({results:sql.prepare(s.query).all(...s.args)}));sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}},BOOKING_GOOGLE_CLIENT_ID:'id',BOOKING_GOOGLE_CLIENT_SECRET:'secret',BOOKING_GOOGLE_REFRESH_TOKEN:'refresh',BOOKING_CALENDAR_ID:'primary'};
 events=new Map();calls=[];failPatch=false;failDelete=false;busyBlocks=[];failMail=false;
 mock.method(globalThis,'fetch',async(url,options={})=>{
  const u=new URL(url),method=options.method||'GET',data=options.body&&method!=='GET'?JSON.parse(typeof options.body==='string'?options.body:'{}'):null;
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'access'});
  calls.push({url:u,method,data,headers:options.headers});
  if(u.hostname==='gmail.googleapis.com')return failMail?Response.json({error:'unavailable'},{status:503}):Response.json({id:'sent'});
  if(u.pathname.endsWith('/freeBusy'))return Response.json({calendars:{primary:{busy:busyBlocks}}});
  const id=u.pathname.split('/').at(-1);
  if(id==='events'&&method==='GET')return Response.json({items:[...events.values()]});
  if(id==='events'&&method==='POST'){const event={...data,organizer:{email:'host@example.com'},etag:'"v1"'};events.set(data.id,event);return Response.json(event);}
  if(method==='GET')return events.has(id)?Response.json(events.get(id)):Response.json({}, {status:404});
  if(method==='PATCH'){const event=events.get(id);events.set(id,{...event,...data,etag:'"v2"'});if(failPatch)throw Error('Lost response');return Response.json(events.get(id));}
  if(method==='DELETE'){events.delete(id);if(failDelete)throw Error('Lost response');return new Response(null,{status:204});}
  throw Error('Unexpected Google call');
 });
});
afterEach(()=>{mock.restoreAll();sql.close();});
test('invitation contains a private management link and requests email delivery',async()=>{
 const start=nextSlot();const r=await req('reserve',{start:new Date(start).toISOString(),name:'Guest',email:'guest@example.com',notes:'Hello'});
 assert.equal(r.status,201);const call=calls.find(c=>c.method==='POST'&&c.url.pathname.endsWith('/events'));assert.equal(call.url.searchParams.get('sendUpdates'),'all');assert.match(call.data.description,/https:\/\/calendar.morisoba.moe\/manage#token=/);assert.equal(call.data.attendees[0].email,'guest@example.com');assert.equal(r.data.eventId,call.data.id);
});
test('management requires an unguessable token and same-origin writes',async()=>{seed();assert.equal((await req('manage',{token:'wrong'})).status,404);assert.equal((await req('manage',{token},{Origin:'https://evil.example'})).status,403);assert.equal((await req('manage',{token})).data.status,'confirmed');});
test('reschedule preserves event and attendees, supports overlapping own slots, and emails updates',async()=>{
 const old=seed(),start=old+900000,r=await req('reschedule',{token,start:new Date(start).toISOString()});assert.equal(r.status,200);assert.equal(events.size,1);assert.equal(events.get('abc').attendees[0].email,'guest@example.com');assert.equal(sql.prepare("SELECT start_ms FROM booking_reservations WHERE id='abc'").get().start_ms,start);
 assert.deepEqual(sql.prepare('SELECT start_ms FROM booking_slot_locks ORDER BY start_ms').all().map(x=>x.start_ms),[start,start+900000]);const patch=calls.find(c=>c.method==='PATCH');assert.equal(patch.url.searchParams.get('sendUpdates'),'all');assert.equal(patch.headers['If-Match'],'"v1"');
});
test('an occupied replacement slot leaves the original booking intact',async()=>{
 const old=seed(),start=old+3600000;sql.prepare("INSERT INTO booking_reservations(id,start_ms,status,cancel_token,created_ms) VALUES('other',?,'confirmed','other',1)").run(start);sql.prepare("INSERT INTO booking_slot_locks VALUES(?,'other')").run(start);
 assert.equal((await req('reschedule',{token,start:new Date(start).toISOString()})).status,409);assert.equal(sql.prepare("SELECT start_ms FROM booking_reservations WHERE id='abc'").get().start_ms,old);assert.equal(sql.prepare('SELECT count(*) AS n FROM booking_operations').get().n,0);assert.ok(!calls.some(c=>c.method==='PATCH'));
});
test('external conflicts and invalid times cannot be rescheduled',async()=>{const old=seed(),start=old+3600000;events.set('other',{id:'other',start:{dateTime:new Date(start).toISOString()},end:{dateTime:new Date(start+1800000).toISOString()}});assert.equal((await req('reschedule',{token,start:new Date(start).toISOString()})).status,409);assert.equal((await req('reschedule',{token,start:'invalid'})).status,400);});
test('lost reschedule response keeps both times locked until Google confirms the result',async()=>{
 const old=seed(),start=old+3600000;failPatch=true;assert.equal((await req('reschedule',{token,start:new Date(start).toISOString()})).status,503);assert.equal(sql.prepare('SELECT count(*) AS n FROM booking_slot_locks').get().n,4);assert.equal(sql.prepare('SELECT count(*) AS n FROM booking_operations').get().n,1);
 const r=await req('manage',{token});assert.equal(r.status,200);assert.equal(r.data.start,new Date(start).toISOString());assert.equal(sql.prepare('SELECT count(*) AS n FROM booking_slot_locks').get().n,2);assert.equal(sql.prepare('SELECT count(*) AS n FROM booking_operations').get().n,0);
});
test('cancel emails attendees, releases locks and is idempotent',async()=>{seed();assert.equal((await req('cancel',{token})).status,200);assert.equal((await req('cancel',{token})).status,200);assert.equal(sql.prepare('SELECT count(*) AS n FROM booking_slot_locks').get().n,0);assert.equal((await req('manage',{token})).data.status,'cancelled');const deletes=calls.filter(c=>c.method==='DELETE');assert.equal(deletes.length,1);assert.equal(deletes[0].url.searchParams.get('sendUpdates'),'all');});
test('lost cancellation response is reconciled without freeing an uncertain booking early',async()=>{seed();failDelete=true;assert.equal((await req('cancel',{token})).status,503);assert.equal(sql.prepare('SELECT count(*) AS n FROM booking_slot_locks').get().n,2);assert.equal((await req('manage',{token})).data.status,'cancelled');assert.equal(sql.prepare('SELECT count(*) AS n FROM booking_slot_locks').get().n,0);});

test('Meet creation is requested and buffers protect neighboring slots',async()=>{
 const type={slug:'chat',title:'Chat',duration:30,timezone:'America/New_York',days:[1,2,3,4,5],startMinute:780,endMinute:1020,noticeHours:24,horizonDays:30,bufferBefore:15,bufferAfter:15,googleMeet:true,reminders:true,maxPerDay:0};
 sql.prepare('INSERT INTO booking_types VALUES(?,?,1,1,1)').run(type.slug,JSON.stringify(type));
 const start=nextSlot(),r=await req('reserve',{slug:'chat',start:new Date(start).toISOString(),name:'Guest',email:'guest@example.com'});assert.equal(r.status,201);
 assert.equal(calls.find(c=>c.data?.conferenceData).data.conferenceData.createRequest.conferenceSolutionKey.type,'hangoutsMeet');
 assert.equal(sql.prepare('SELECT count(*) n FROM booking_slot_locks').get().n,4);
 assert.equal((await req('reserve',{start:new Date(start+1800000).toISOString(),name:'Guest',email:'guest@example.com'})).status,409);
});
test('daily cap includes an in-flight reschedule into the target day',async()=>{
 const type={slug:'chat',title:'Chat',duration:30,timezone:'America/New_York',days:[1,2,3,4,5],startMinute:780,endMinute:1020,noticeHours:24,horizonDays:30,maxPerDay:1};
 sql.prepare('INSERT INTO booking_types VALUES(?,?,1,1,1)').run(type.slug,JSON.stringify(type));
 const start=seed(),day=new Intl.DateTimeFormat('en-CA',{timeZone:type.timezone}).format(start);
 sql.prepare("UPDATE booking_reservations SET booking_slug='chat',booking_day='2099-01-01' WHERE id='abc'").run();
 sql.prepare("INSERT INTO booking_operations(reservation_id,operation_id,action,target_start_ms,target_day,created_ms) VALUES('abc','op','reschedule',?,?,1)").run(start,day);
 const r=await req('reserve',{slug:'chat',start:new Date(start+3600000).toISOString(),name:'Guest',email:'guest@example.com'});assert.equal(r.status,409);assert.match(r.data.error,/limit/);
});

test('reminders send once per threshold and skip declined attendees',async()=>{
 const start=seed();sql.prepare("UPDATE booking_reservations SET reminders=1,created_ms=? WHERE id='abc'").run(start-2*86400000);
 events.get('abc').attendees.push({email:'declined@example.com',responseStatus:'declined'});
 const now=start-23*3600000;
 assert.deepEqual(await sendBookingReminders(env,now),{sent:1,failed:0});
 assert.deepEqual(await sendBookingReminders(env,now+300000),{sent:0,failed:0});
 assert.deepEqual(await sendBookingReminders(env,start-3500000),{sent:1,failed:0});
 const mails=calls.filter(c=>c.url.hostname==='gmail.googleapis.com');assert.equal(mails.length,2);assert.match(Buffer.from(mails[0].data.raw,'base64url').toString(),/To: guest@example.com/);
 sql.prepare("UPDATE booking_reservations SET status='cancelled'").run();assert.deepEqual(await sendBookingReminders(env,now),{sent:0,failed:0});
});
test('reminder windows exclude late-created and past meetings, MIME rejects header injection',()=>{
 const start=1000000000;assert.equal(reminderKind({start_ms:start,created_ms:start-300000},start-100000),null);assert.equal(reminderKind({start_ms:start,created_ms:1},start),null);
 assert.throws(()=>reminderMessage({recipient:'a@example.com\r\nBcc: other@example.com',subject:'x',text:'x',id:'id'}));
});

test('month availability agrees with daily slots and omits fully busy days across visitor timezones',async()=>{
 const start=nextSlot(),day=new Date(start).toISOString().slice(0,10),month=day.slice(0,7);
 busyBlocks=[{start:day+'T00:00:00Z',end:new Date(Date.parse(day)+86400000).toISOString()}];
 async function get(path){const response=await bookingMiddleware(new Request(origin+'/api/booking/'+path),env,()=>new Response('fallback'));assert.equal(response.status,200);return response.json();}
 const result=await get('days?month='+month+'&timezone=America%2FNew_York');assert.ok(!result.days.includes(day));assert.equal(calls.filter(c=>c.url.pathname.endsWith('/freeBusy')).length,1);
 for(const date of result.days){const daily=await get('slots?date='+date+'&timezone=America%2FNew_York');assert.ok(daily.slots.length>0);}
 const tokyo=await get('days?month='+month+'&timezone=Asia%2FTokyo');
 for(const date of tokyo.days){const daily=await get('slots?date='+date+'&timezone=Asia%2FTokyo');assert.ok(daily.slots.length>0);}
});

test('new booking sends host a separate receipt with guest details and management link',async()=>{
 const r=await req('reserve',{start:new Date(nextSlot()).toISOString(),name:'Guest',email:'guest@example.com',notes:'Discuss plans'});assert.equal(r.status,201);
 const mail=calls.find(c=>c.url.hostname==='gmail.googleapis.com');assert.ok(mail);
 const mime=Buffer.from(mail.data.raw,'base64url').toString();assert.match(mime,/To: host@example.com/);
 const text=Buffer.from(mime.split('\r\n\r\n')[1],'base64').toString();assert.match(text,/Guest: Guest <guest@example.com>/);assert.match(text,/Discuss plans/);assert.match(text,/Manage booking: https:\/\/calendar.morisoba.moe\/manage#token=/);
 assert.equal(sql.prepare("SELECT status FROM booking_reminder_deliveries WHERE kind='host-booked'").get().status,'sent');
});
test('host email failure preserves successful booking and records delivery trouble',async()=>{
 failMail=true;const r=await req('reserve',{start:new Date(nextSlot()).toISOString(),name:'Guest',email:'guest@example.com'});assert.equal(r.status,201);
 assert.equal(sql.prepare('SELECT status FROM booking_reservations').get().status,'confirmed');assert.equal(sql.prepare("SELECT status FROM booking_reminder_deliveries WHERE kind='host-booked'").get().status,'failed');
});

const details=()=>({start:new Date(nextSlot()).toISOString(),name:'Guest',email:'guest@example.com'});
function emailBody(call){return Buffer.from(Buffer.from(call.data.raw,'base64url').toString().split('\r\n\r\n')[1],'base64').toString();}
test('unverified and wrong-address bookings cannot call Google or acquire slots',async()=>{
 assert.equal((await req('reserve',details(),{},false)).status,403);
 assert.equal((await req('reserve',{...details(),...verified('other@example.com')},{},false)).status,403);
 assert.equal(calls.length,0);assert.equal(sql.prepare('SELECT count(*) n FROM booking_reservations').get().n,0);
});
test('verification sends a code but creates no calendar event and only stores its hash',async()=>{
 const r=await req('verify',{email:'guest@example.com'});assert.equal(r.status,200);
 const mail=calls.find(c=>c.url.hostname==='gmail.googleapis.com'),code=emailBody(mail).match(/code is: (\d{6})/)[1];
 assert.equal(sql.prepare('SELECT code_hash FROM booking_verifications').get().code_hash,digest(r.data.verificationId+':'+code));
 assert.equal(sql.prepare('SELECT count(*) n FROM booking_reservations').get().n,0);assert.ok(!calls.some(c=>c.url.hostname==='www.googleapis.com'));
 const booked=await req('reserve',{...details(),verificationId:r.data.verificationId,code},{},false);assert.equal(booked.status,201);
});
test('verification expires, limits guesses across IPs and rejects replay',async()=>{
 const proof=verified();sql.prepare('UPDATE booking_verifications SET expires_ms=1').run();
 assert.equal((await req('reserve',{...details(),...proof},{},false)).status,403);
 const active=verified();for(let i=0;i<5;i++)assert.equal((await req('reserve',{...details(),...active,code:'999999'},{'CF-Connecting-IP':'ip'+i},false)).status,403);
 assert.equal((await req('reserve',{...details(),...active},{'CF-Connecting-IP':'other-ip'},false)).status,403);
 const fresh=verified(),first=await req('reserve',{...details(),...fresh},{'CF-Connecting-IP':'fresh'},false);assert.equal(first.status,201);
 assert.equal((await req('reserve',{...details(),start:new Date(nextSlot()+3600000).toISOString(),...fresh},{'CF-Connecting-IP':'fresh'},false)).status,403);
});
test('one verification code cannot create concurrent reservations',async()=>{
 const proof=verified();const r=await Promise.all([0,3600000].map(offset=>req('reserve',{...details(),start:new Date(nextSlot()+offset).toISOString(),...proof},{},false)));
 assert.equal(r.filter(x=>x.status===201).length,1);assert.equal(sql.prepare('SELECT count(*) n FROM booking_reservations').get().n,1);
});
test('two upcoming bookings per address is atomic and Gmail aliases share the cap',async()=>{
 const email='g.u.e.s.t+first@gmail.com',key=emailKey(bookingEmail(email));assert.equal(key,emailKey('guest+second@googlemail.com'));
 sql.prepare("INSERT INTO booking_reservations(id,start_ms,status,cancel_token,created_ms,email_key) VALUES('existing',?,'confirmed','existing',?,?)").run(nextSlot()+7200000,Date.now()-10000,key);
 const responses=await Promise.all([0,3600000].map(offset=>req('reserve',{...details(),email:offset?'guest+second@gmail.com':email,start:new Date(nextSlot()+offset).toISOString()})));
 assert.equal(responses.filter(x=>x.status===201).length,1);assert.equal(responses.filter(x=>x.status===409).length,1);
});
test('cancelling does not reset daily booking cap',async()=>{
 for(let i=0;i<3;i++)sql.prepare("INSERT INTO booking_reservations(id,start_ms,status,cancel_token,created_ms,email_key) VALUES(?,?,'cancelled',?,?,?)").run('old'+i,nextSlot()+i*3600000,'old'+i,Date.now()-1000,emailKey('guest@example.com'));
 assert.equal((await req('reserve',details())).status,409);assert.ok(!calls.some(c=>c.url.pathname.endsWith('/events')));
});
test('verification email limits apply across aliases and IPs; forwarded headers cannot bypass IP limit',async()=>{
 for(let i=0;i<3;i++)assert.equal((await req('verify',{email:'g.u.e.s.t+'+i+'@gmail.com'},{'CF-Connecting-IP':'ip'+i})).status,200);
 assert.equal((await req('verify',{email:'guest+other@googlemail.com'},{'CF-Connecting-IP':'ip-other'})).status,429);
 for(let i=0;i<3;i++)assert.equal((await req('verify',{email:'person'+i+'@example.com'},{'CF-Connecting-IP':'same','X-Forwarded-For':'fake'+i})).status,200);
 assert.equal((await req('verify',{email:'another@example.com'},{'CF-Connecting-IP':'same','X-Forwarded-For':'different'})).status,429);
});
test('verification delivery failure invalidates code and creates no reservation',async()=>{
 failMail=true;assert.equal((await req('verify',{email:'guest@example.com'})).status,503);
 assert.equal(sql.prepare('SELECT count(*) n FROM booking_verifications').get().n,0);assert.equal(sql.prepare('SELECT count(*) n FROM booking_reservations').get().n,0);
});
test('global booking ceiling applies across addresses and survives cancellations',async()=>{
 for(let i=0;i<20;i++)sql.prepare("INSERT INTO booking_reservations(id,start_ms,status,cancel_token,created_ms,email_key) VALUES(?,?,'cancelled',?,?,?)").run('global'+i,nextSlot(),'global'+i,Date.now()-1000,emailKey('guest'+i+'@example.com'));
 assert.equal((await req('reserve',details())).status,409);assert.ok(!calls.some(c=>c.url.pathname.endsWith('/events')));
});
test('cross-origin verification cannot send email',async()=>{assert.equal((await req('verify',{email:'guest@example.com'},{Origin:'https://evil.example'})).status,403);assert.equal(calls.length,0);});
