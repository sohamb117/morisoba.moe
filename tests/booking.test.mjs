import {test} from 'node:test';
import assert from 'node:assert/strict';
import {candidates,validSlot,bookingMiddleware} from '../middleware/booking.mjs';
const e={BOOKING_TIMEZONE:'America/New_York'};
test('host hours follow DST and visitor timezone boundaries',()=>{
 const now=Date.parse('2026-10-27T00:00:00Z');
 assert.equal(validSlot(Date.parse('2026-10-30T17:00:00Z'),e,now),true);
 assert.equal(validSlot(Date.parse('2026-11-02T18:00:00Z'),e,now),true);
 assert.equal(validSlot(Date.parse('2026-11-02T17:00:00Z'),e,now),false);
 assert.equal(validSlot(Date.parse('2026-10-31T17:00:00Z'),e,now),false);
 const japan=candidates('2026-11-03','Asia/Tokyo',e,now);
 assert.equal(japan.length,15);assert.equal(new Date(japan[0]).toISOString(),'2026-11-02T18:00:00.000Z');
});
test('notice, horizon and quarter-hour boundaries are enforced',()=>{
 const now=Date.parse('2026-10-29T18:00:00Z');
 for(const t of ['2026-10-30T17:00:00Z','2026-12-01T18:00:00Z','2026-11-02T18:07:00Z','2026-11-02T18:00:01Z'])assert.equal(validSlot(Date.parse(t),e,now),false,t);
 assert.deepEqual(candidates('invalid','UTC',e,now),[]);
});
test('unconfigured calendar fails closed; other routes pass through',async()=>{
 let r=await bookingMiddleware(new Request('https://morisoba.moe/api/booking/config'),{},()=>{});assert.equal((await r.json()).ready,false);
 r=await bookingMiddleware(new Request('https://morisoba.moe/api/booking/slots'),{},()=>{});assert.equal(r.status,503);
 assert.equal(await bookingMiddleware(new Request('https://morisoba.moe/'),{},()=>42),42);
});
test('cross-origin writes are rejected before storage access',async()=>{
 const env={MIMORI_DB:{},BOOKING_GOOGLE_CLIENT_ID:'x',BOOKING_GOOGLE_CLIENT_SECRET:'x',BOOKING_GOOGLE_REFRESH_TOKEN:'x',BOOKING_CALENDAR_ID:'x'};
 const r=await bookingMiddleware(new Request('https://morisoba.moe/api/booking/reserve',{method:'POST',headers:{Origin:'https://other.example'}}),env,()=>{});
 assert.equal(r.status,403);
});
test('database atomically locks active slots and cancellation releases them',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {readFileSync}=await import('node:fs');
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0003_booking.sql',import.meta.url),'utf8'));
 const insert=db.prepare("INSERT INTO booking_reservations VALUES(?,?,'pending',?,?)");
 insert.run('a',100,'token-a',1);
 assert.throws(()=>insert.run('b',100,'token-b',1),/UNIQUE/);
 db.prepare("UPDATE booking_reservations SET status='cancelled' WHERE id='a'").run();
 insert.run('b',100,'token-b',1);assert.equal(db.prepare("SELECT count(*) AS n FROM booking_reservations WHERE status!='cancelled'").get().n,1);db.close();
});
