import {test} from 'node:test';
import assert from 'node:assert/strict';
import {controlCalendarApi as handle,eventInput} from '../middleware/control-calendar.mjs';
import {instant,eventDays,viewRange} from '../control/calendar-dates.mjs';
const env={MIMORI_DB:{},BOOKING_GOOGLE_CLIENT_ID:'test',BOOKING_GOOGLE_CLIENT_SECRET:'test',BOOKING_GOOGLE_REFRESH_TOKEN:'test',BOOKING_CALENDAR_ID:'primary'};
const event={summary:'Test',start:{dateTime:'2026-11-06T14:00:00Z',timeZone:'America/New_York'},end:{dateTime:'2026-11-06T15:00:00Z',timeZone:'America/New_York'}};
const auth=async()=>({csrf:'good'});
function req(path,method='GET',data,headers={}){return new Request('https://morisoba.moe/api/control/calendar'+path,{method,headers:{Origin:'https://morisoba.moe','X-CSRF-Token':'good',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});}
test('calendar denies anonymous reads and forged writes before Google is called',async()=>{
 const call=()=>assert.fail('Google must not be called');assert.equal((await handle(req('/calendars'),env,{authenticate:async()=>null,call})).status,401);
 for(const headers of [{'X-CSRF-Token':'bad'},{Origin:'https://evil.test'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await handle(req('/events?calendarId=primary','POST',event,headers),env,{authenticate:auth,call})).status,403);
});
test('event ranges are bounded and pagination/recurrence expansion is forwarded',async()=>{
 let url;const options={authenticate:auth,call:async(_,path)=>{url=path;return {items:[],nextPageToken:'next'};}};
 const r=await handle(req('/events?calendarId=a%2Fb&timeMin=2026-11-01T00:00Z&timeMax=2026-12-01T00:00Z&pageToken=next&q=test'),env,options);assert.equal(r.status,200);assert.match(url,/calendars\/a%2Fb\/events/);const p=new URL('https://x/'+url).searchParams;assert.equal(p.get('singleEvents'),'true');assert.equal(p.get('pageToken'),'next');assert.equal(p.get('q'),'test');
 assert.equal((await handle(req('/events?calendarId=primary&timeMin=2020-01-01&timeMax=2026-12-01'),env,options)).status,400);
});
test('event edits use etags, preserve RSVP metadata and never overwrite booking-managed events',async()=>{
 let current={...event,etag:'v1',attendees:[{email:'a@example.test',responseStatus:'accepted',optional:true}]},writes=[];
 const options={authenticate:auth,call:async(_,url,data,method,headers)=>{if(method==='GET')return current;writes.push({data,method,headers});return data;}};
 const path='/event?calendarId=primary&eventId=e';
 assert.equal((await handle(req(path,'PATCH',{...event,etag:'old'}),env,options)).status,412);assert.equal(writes.length,0);
 const r=await handle(req(path,'PATCH',{...event,etag:'v1',attendees:[{email:'a@example.test'}]}),env,options);assert.equal(r.status,200);assert.equal(writes[0].headers['If-Match'],'v1');assert.equal(writes[0].data.attendees[0].responseStatus,'accepted');
 current.extendedProperties={private:{bookingId:'booking'}};assert.equal((await handle(req(path,'DELETE',{etag:'v1'}),env,options)).status,409);assert.equal(writes.length,1);
});
test('event input rejects malformed times, reversed dates and injected recurrence fields',()=>{
 assert.throws(()=>eventInput({...event,end:event.start}));assert.throws(()=>eventInput({...event,start:{date:'2026-11-06'}}));assert.throws(()=>eventInput({...event,recurrence:['RRULE:FREQ=DAILY\nATTENDEE:other']}));assert.throws(()=>eventInput({...event,reminders:{useDefault:false,overrides:[{minutes:-1,method:'popup'}]}}));
 assert.deepEqual(eventInput({...event,organizer:{email:'fake'},extendedProperties:{private:{bookingId:'fake'}}}),event);
});
test('calendar dates handle DST and all-day exclusive ends',()=>{
 assert.equal(instant('2026-11-06T09:00','America/New_York'),'2026-11-06T14:00:00.000Z');assert.equal(instant('2026-07-06T09:00','America/New_York'),'2026-07-06T13:00:00.000Z');assert.throws(()=>instant('2026-03-08T02:30','America/New_York'));
 assert.deepEqual(eventDays({start:{date:'2026-11-06'},end:{date:'2026-11-07'}},'America/New_York'),['2026-11-06','2026-11-07']);
 assert.deepEqual(eventDays({start:{dateTime:'2026-11-06T23:00:00-05:00'},end:{dateTime:'2026-11-07T00:00:00-05:00'}},'America/New_York'),['2026-11-06','2026-11-07']);assert.deepEqual(viewRange('2026-11-06','week'),['2026-11-01','2026-11-08']);
});
