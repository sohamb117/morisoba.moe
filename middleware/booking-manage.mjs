import {json,body,HttpError,throttle} from './booking-admin.mjs';
import {digest} from './mimori-crypto.mjs';
const MIN=60000;
const pending='A calendar update is still being confirmed. Please contact Soham before trying again.';
export async function manageBooking(request,e,helpers){
 const {google,getType,candidates,validSlot,configured,bookingDay}=helpers,db=e.MIMORI_DB;
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(!configured(e))return json({error:'Calendar unavailable'},503);
 const d=await body(request,2048),token=String(d.token||'');
 await throttle(db,'manage:'+digest(request.headers.get('CF-Connecting-IP')||'unknown'),60);
 if(!/^[a-f0-9-]{72}$/.test(token))return json({error:'Booking not found'},404);
 let row=await db.prepare('SELECT * FROM booking_reservations WHERE cancel_token=?').bind(token).first();
 if(!row)return json({error:'Booking not found'},404);
 const path=new URL(request.url).pathname,calendar=row.calendar_id||e.BOOKING_CALENDAR_ID;
 const eventPath='calendars/'+encodeURIComponent(calendar)+'/events/'+row.id;
 const operation=await db.prepare('SELECT * FROM booking_operations WHERE reservation_id=?').bind(row.id).first();
 // A request can lose its response after Google commits. Reconcile only positive evidence;
 // otherwise retain both slot locks so an uncertain update cannot cause double bookings.
 let event;
 if(operation){
  try{event=await google(e,eventPath,null,'GET');}catch(err){if(err.status===404||err.status===410)event={status:'cancelled'};else throw err;}
  if(operation.action==='cancel'&&event.status==='cancelled'){
   await finishCancel(db,row.id,operation.operation_id);row.status='cancelled';
  }else if(operation.action==='reschedule'&&Date.parse(event.start?.dateTime)===operation.target_start_ms){
   await finishReschedule(db,row,operation.target_start_ms,operation.operation_id,operation.target_day);row.start_ms=operation.target_start_ms;
  }else return json({error:pending},409);
 }
 if(row.status==='pending')return json({error:pending},409);
 const type=await getType(e,row.booking_slug),duration=row.duration_minutes*MIN,before=(row.buffer_before||0)*MIN,after=(row.buffer_after||0)*MIN;
 if(path==='/api/booking/manage'){
  if(row.status!=='cancelled'&&!event){try{event=await google(e,eventPath,null,'GET');}catch(err){if(err.status===404||err.status===410)event={status:'cancelled'};else throw err;}}
  if(event?.status==='cancelled'&&row.status!=='cancelled'){await finishCancel(db,row.id);row.status='cancelled';}
  const start=event?.start?.dateTime||new Date(row.start_ms).toISOString();
  return json({status:row.status,title:event?.summary||type?.title||'Booking',start,duration:row.duration_minutes,location:event?.hangoutLink||event?.conferenceData?.entryPoints?.find(p=>p.entryPointType==='video')?.uri||event?.location||type?.location||'',timezone:type?.timezone||'America/New_York',canReschedule:row.status==='confirmed'&&!!type&&Date.parse(start)>Date.now(),canCancel:row.status==='confirmed'&&Date.parse(start)>Date.now()});
 }
 if(row.status==='cancelled')return path==='/api/booking/cancel'?json({cancelled:true}):json({error:'This booking is cancelled.'},409);
 if(row.start_ms<=Date.now())return json({error:'Past bookings cannot be changed.'},409);
 if(path==='/api/booking/cancel'){
  const operationId=crypto.randomUUID();
  try{await db.prepare("INSERT INTO booking_operations(reservation_id,operation_id,action,created_ms) VALUES(?,?,'cancel',?)").bind(row.id,operationId,Date.now()).run();}catch(err){if(/UNIQUE|constraint/i.test(String(err)))return json({error:pending},409);throw err;}
  await google(e,eventPath+'?sendUpdates=all',null,'DELETE');
  await finishCancel(db,row.id,operationId);return json({cancelled:true});
 }
 if(!type)return json({error:'Rescheduling is unavailable for this booking page. You can still cancel.'},409);
 const schedule={...type,duration:row.duration_minutes};
 if(path==='/api/booking/manage/slots'){
  const zone=d.timezone||'UTC';try{new Intl.DateTimeFormat('en-US',{timeZone:zone}).format();}catch{return json({error:'Invalid timezone'},400);}
  const slots=candidates(String(d.date||''),zone,e,Date.now(),schedule);if(!slots.length)return json({slots:[]});
  const blocks=await otherEvents(google,e,calendar,row.id,slots[0]-before,slots.at(-1)+duration+after);
  const {results}=await db.prepare('SELECT start_ms FROM booking_slot_locks WHERE start_ms>=? AND start_ms<? AND reservation_id!=?').bind(slots[0]-before,slots.at(-1)+duration+after,row.id).all();
  const counts=type.maxPerDay?(await db.prepare("SELECT booking_day,count(*) AS n FROM booking_day_usage WHERE booking_slug=? AND id!=? GROUP BY booking_day").bind(row.booking_slug,row.id).all()).results:[];
  return json({slots:slots.filter(t=>t!==row.start_ms&&!counts.some(c=>c.booking_day===bookingDay(t,type.timezone)&&c.n>=type.maxPerDay)&&!results.some(r=>r.start_ms>=t-before&&r.start_ms<t+duration+after)&&!blocks.some(b=>t-before<b.end&&t+duration+after>b.start)).map(t=>new Date(t).toISOString())});
 }
 if(path!=='/api/booking/reschedule')return json({error:'Not found'},404);
 const start=Date.parse(d.start);
 if(!validSlot(start,e,Date.now(),schedule)||start===row.start_ms)return json({error:'Choose a valid new time.'},400);
 event=await google(e,eventPath,null,'GET');
 if(event.status==='cancelled')return json({error:'This booking was cancelled in Google Calendar.'},409);
 const blocks=await otherEvents(google,e,calendar,row.id,start-before,start+duration+after);
 if(blocks.some(b=>start-before<b.end&&start+duration+after>b.start))return json({error:'That time is no longer available.'},409);
 const operationId=crypto.randomUUID(),day=bookingDay(start,type.timezone);
 const statements=[db.prepare("INSERT INTO booking_operations(reservation_id,operation_id,action,target_start_ms,created_ms,target_day) SELECT ?,?,'reschedule',?,?,? WHERE (SELECT count(*) FROM booking_day_usage WHERE booking_slug=? AND booking_day=? AND id!=?)<? RETURNING reservation_id").bind(row.id,operationId,start,Date.now(),day,row.booking_slug,day,row.id,type.maxPerDay||1000000)];
 for(let t=start-before;t<start+duration+after;t+=15*MIN)statements.push(db.prepare('INSERT INTO booking_slot_locks(start_ms,reservation_id) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM booking_slot_locks WHERE start_ms=? AND reservation_id=?) AND EXISTS(SELECT 1 FROM booking_operations WHERE operation_id=?)').bind(t,row.id,t,row.id,operationId));
 try{const result=await db.batch(statements);if(!result[0].results.length)return json({error:'The booking limit for this day has been reached.'},409);}catch(err){if(/UNIQUE|constraint/i.test(String(err)))return json({error:'That time was just taken or this booking is already being updated.'},409);throw err;}
 await google(e,eventPath+'?sendUpdates=all',{start:{dateTime:new Date(start).toISOString()},end:{dateTime:new Date(start+duration).toISOString()}},'PATCH',{'If-Match':event.etag});
 await finishReschedule(db,row,start,operationId,day);
 return json({rescheduled:true,start:new Date(start).toISOString(),duration:row.duration_minutes});
}
async function finishCancel(db,id,operationId=null){
 const guard=operationId?'EXISTS(SELECT 1 FROM booking_operations WHERE reservation_id=? AND operation_id=?)':'NOT EXISTS(SELECT 1 FROM booking_operations WHERE reservation_id=?)';
 const args=operationId?[id,operationId]:[id];
 await db.batch([db.prepare("UPDATE booking_reservations SET status='cancelled' WHERE id=? AND "+guard).bind(id,...args),db.prepare('DELETE FROM booking_slot_locks WHERE reservation_id=? AND '+guard).bind(id,...args),db.prepare('DELETE FROM booking_operations WHERE reservation_id=? AND operation_id=?').bind(id,operationId)]);
}
async function finishReschedule(db,row,start,operationId,day){
 const guard='EXISTS(SELECT 1 FROM booking_operations WHERE reservation_id=? AND operation_id=?)';
 await db.batch([db.prepare('UPDATE booking_reservations SET start_ms=?,booking_day=? WHERE id=? AND '+guard).bind(start,day,row.id,row.id,operationId),db.prepare('DELETE FROM booking_slot_locks WHERE reservation_id=? AND (start_ms<? OR start_ms>=?) AND '+guard).bind(row.id,start-(row.buffer_before||0)*MIN,start+(row.duration_minutes+(row.buffer_after||0))*MIN,row.id,operationId),db.prepare('DELETE FROM booking_operations WHERE reservation_id=? AND operation_id=?').bind(row.id,operationId)]);
}
async function otherEvents(google,e,calendar,id,min,max){
 const blocks=[];let pageToken;
 do{
  const q=new URLSearchParams({timeMin:new Date(min).toISOString(),timeMax:new Date(max).toISOString(),singleEvents:'true',maxResults:'2500',...(pageToken?{pageToken}:{})});
  const result=await google(e,'calendars/'+encodeURIComponent(calendar)+'/events?'+q,null,'GET');
  for(const event of result.items||[]){if(event.id===id||event.status==='cancelled'||event.transparency==='transparent')continue;
   // All-day events are conservatively blocked across their full possible timezone span.
   const start=event.start?.dateTime?Date.parse(event.start.dateTime):Date.parse(event.start?.date)-14*60*MIN;
   const end=event.end?.dateTime?Date.parse(event.end.dateTime):Date.parse(event.end?.date)+14*60*MIN;
   if(!Number.isFinite(start)||!Number.isFinite(end))throw new HttpError(503,'Could not verify calendar availability.');blocks.push({start,end});
  }
  pageToken=result.nextPageToken;
 }while(pageToken);
 return blocks;
}
