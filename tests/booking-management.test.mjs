import {test,beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {bookingMiddleware} from '../middleware/booking.mjs';
let sql,env,events,calls,failPatch,failDelete;
const token='11111111-1111-1111-1111-11111111111122222222-2222-2222-2222-222222222222';
const origin='https://calendar.morisoba.moe';
function stmt(query,args=[]){return {bind(...v){return stmt(query,v);},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);},query,args};}
async function req(path,data,headers={}){const r=await bookingMiddleware(new Request(origin+'/api/booking/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)}),env,()=>new Response('fallback'));return {status:r.status,data:await r.json()};}
function nextSlot(){let d=new Date(Date.now()+3*86400000);d.setUTCHours(19,0,0,0);while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()+1);return d.getTime();}
function seed(start=nextSlot()){
 sql.prepare("INSERT INTO booking_reservations(id,start_ms,status,cancel_token,created_ms,duration_minutes,calendar_id) VALUES('abc',?,'confirmed',?,?,30,'primary')").run(start,token,Date.now());
 sql.prepare("INSERT INTO booking_slot_locks VALUES(?,'abc')").run(start);sql.prepare("INSERT INTO booking_slot_locks VALUES(?,'abc')").run(start+900000);
 events.set('abc',{id:'abc',etag:'"v1"',status:'confirmed',summary:'Meeting / Guest',start:{dateTime:new Date(start).toISOString()},end:{dateTime:new Date(start+1800000).toISOString()},attendees:[{email:'guest@example.com'}]});return start;
}
beforeEach(()=>{
 sql=new DatabaseSync(':memory:');for(const n of ['0003_booking.sql','0004_booking_portal.sql','0005_booking_password.sql','0006_booking_management.sql'])sql.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 env={MIMORI_DB:{prepare:stmt,async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>({results:sql.prepare(s.query).all(...s.args)}));sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}},BOOKING_GOOGLE_CLIENT_ID:'id',BOOKING_GOOGLE_CLIENT_SECRET:'secret',BOOKING_GOOGLE_REFRESH_TOKEN:'refresh',BOOKING_CALENDAR_ID:'primary'};
 events=new Map();calls=[];failPatch=false;failDelete=false;
 mock.method(globalThis,'fetch',async(url,options={})=>{
  const u=new URL(url),method=options.method||'GET',data=options.body&&method!=='GET'?JSON.parse(typeof options.body==='string'?options.body:'{}'):null;
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'access'});
  calls.push({url:u,method,data,headers:options.headers});
  if(u.pathname.endsWith('/freeBusy'))return Response.json({calendars:{primary:{busy:[]}}});
  const id=u.pathname.split('/').at(-1);
  if(id==='events'&&method==='GET')return Response.json({items:[...events.values()]});
  if(id==='events'&&method==='POST'){events.set(data.id,{...data,etag:'"v1"'});return Response.json(data);}
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
