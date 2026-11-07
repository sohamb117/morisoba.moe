import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionsApi,protocolAdminApi} from '../middleware/control-connections.mjs';
import {dayKey} from '../control/calendar-dates.mjs';
const request=()=>new Request('https://morisoba.moe/api/control/connections');
test('connection and protocol metadata require the owner session',async()=>{
 for(const handler of [connectionsApi,protocolAdminApi])assert.equal((await handler(request(),{},{authenticate:async()=>null})).status,401);
});
test('connection manager checks shared event and list grants without returning credentials',async()=>{
 const env={MIMORI_DB:{prepare(sql){return {async first(){return sql.includes('COUNT(*)')?{n:0}:null;}};}},BOOKING_GOOGLE_CLIENT_ID:'secret-id',BOOKING_GOOGLE_CLIENT_SECRET:'secret-key',BOOKING_GOOGLE_REFRESH_TOKEN:'secret-token',BOOKING_CALENDAR_ID:'primary',CONTROL_OWNER_EMAIL:'owner@example.test',MIMORI_PROTOCOL_ENABLED:'true',MIMORI_PROTOCOL_DB:{}};
 const paths=[];const r=await connectionsApi(request(),env,{authenticate:async()=>({}),call:async(_,path)=>{paths.push(path);return {};}});const text=await r.text(),data=JSON.parse(text);assert.equal(data.connections.find(c=>c.id==='google').events,true);assert.equal(data.connections.find(c=>c.id==='google').calendarList,true);assert.equal(data.connections.find(c=>c.id==='mimori').connected,true);assert.equal(paths.length,2);assert.doesNotMatch(text,/secret-/);
});
test('civil date keys never depend on locale separator or field ordering',()=>{
 assert.equal(dayKey(new Date('2026-01-01T00:30Z'),'America/New_York'),'2025-12-31');
 assert.equal(dayKey(new Date('2026-11-06T10:00Z'),'UTC'),'2026-11-06');
});
