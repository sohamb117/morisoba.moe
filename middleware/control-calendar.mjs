import {controlGoogle} from './control-calendar-oauth.mjs';
import {controlSession} from './control-auth.mjs';
import {configured} from './booking-google.mjs';
import {body,HttpError,json} from './booking-admin.mjs';
const enc=encodeURIComponent;
const fail=(message)=>{throw new HttpError(400,message);};
export function eventInput(d){
 const out={};
 for(const [key,max] of [['summary',1024],['description',16000],['location',2000]])if(key in d){if(typeof d[key]!=='string'||d[key].length>max)fail('Invalid '+key);out[key]=d[key];}
 if(!d.start||!d.end)fail('Start and end are required');
 for(const key of ['start','end']){
  const v=d[key];
  if(v.date){if(!/^\d{4}-\d{2}-\d{2}$/.test(v.date)||!Number.isFinite(Date.parse(v.date)))fail('Invalid date');out[key]={date:v.date};}
  else{if(typeof v.dateTime!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(v.dateTime)||!Number.isFinite(Date.parse(v.dateTime)))fail('Invalid time');try{new Intl.DateTimeFormat('en',{timeZone:v.timeZone}).format();}catch{fail('Invalid timezone');}out[key]={dateTime:v.dateTime,timeZone:v.timeZone};}
 }
 if(!!out.start.date!==!!out.end.date||Date.parse(out.end.date||out.end.dateTime)<=Date.parse(out.start.date||out.start.dateTime))fail('End must be after start');
 if(d.recurrence!==undefined){if(!Array.isArray(d.recurrence)||d.recurrence.length>20||d.recurrence.some(r=>typeof r!=='string'||r.length>2048||! /^(RRULE|RDATE|EXDATE):[^\r\n]+$/.test(r)))fail('Invalid repeat rule');out.recurrence=d.recurrence;}
 if(d.attendees!==undefined){if(!Array.isArray(d.attendees)||d.attendees.length>200)fail('Too many guests');out.attendees=d.attendees.map(a=>{if(typeof a.email!=='string'||a.email.length>254||!/^\S+@\S+\.\S+$/.test(a.email))fail('Invalid guest email');return {email:a.email,...(a.optional?{optional:true}:{} )};});}
 if(d.reminders!==undefined){if(typeof d.reminders?.useDefault!=='boolean'||!Array.isArray(d.reminders.overrides)||d.reminders.overrides.length>5||d.reminders.overrides.some(r=>!['email','popup'].includes(r.method)||!Number.isInteger(r.minutes)||r.minutes<0||r.minutes>40320))fail('Invalid reminders');out.reminders={useDefault:d.reminders.useDefault,overrides:d.reminders.overrides.map(({method,minutes})=>({method,minutes}))};}
 for(const [key,values] of [['visibility',['default','public','private']],['transparency',['opaque','transparent']]])if(key in d){if(!values.includes(d[key]))fail('Invalid '+key);out[key]=d[key];}
 for(const key of ['guestsCanModify','guestsCanInviteOthers','guestsCanSeeOtherGuests'])if(key in d){if(typeof d[key]!=='boolean')fail('Invalid guest permissions');out[key]=d[key];}
 if('colorId' in d){if(!/^(?:[1-9]|1[01])?$/.test(d.colorId))fail('Invalid color');out.colorId=d.colorId;}
 if(d.addMeet)out.conferenceData={createRequest:{requestId:crypto.randomUUID(),conferenceSolutionKey:{type:'hangoutsMeet'}}};
 return out;
}
export async function controlCalendarApi(request,env,{authenticate=controlSession,call=controlGoogle}={}){
 const u=new URL(request.url),method=request.method,path=u.pathname.slice('/api/control/calendar'.length),q=u.searchParams;
 try{
  const session=await authenticate(request,env);if(!session)return json({error:'Sign in required'},401);
  if(method!=='GET'&&(request.headers.get('Origin')!==u.origin||request.headers.get('X-CSRF-Token')!==session.csrf||request.headers.get('Sec-Fetch-Site')==='cross-site'))return json({error:'Session check failed'},403);
  if(!configured(env))return json({error:'Google Calendar is not connected.'},503);
  if(path==='/calendars'&&method==='GET'){
   let items=[],pageToken;do{const r=await call(env,'users/me/calendarList?'+new URLSearchParams({maxResults:'250',...(pageToken?{pageToken}:{})}),undefined,'GET');items.push(...r.items||[]);pageToken=r.nextPageToken;if(items.length>2500)throw new HttpError(413,'Too many calendars');}while(pageToken);
   return json({items});
  }
  if(path==='/colors'&&method==='GET')return json(await call(env,'colors',undefined,'GET'));
  const id=q.get('calendarId');if(!id||id.length>1024)fail('Calendar required');
  const base='calendars/'+enc(id)+'/events';
  if(path==='/events'&&method==='GET'){
   const min=q.get('timeMin'),max=q.get('timeMax');if(!Number.isFinite(Date.parse(min))||!Number.isFinite(Date.parse(max))||Date.parse(max)<=Date.parse(min)||Date.parse(max)-Date.parse(min)>366*86400000)fail('Choose a range of up to one year');
   const params=new URLSearchParams({timeMin:min,timeMax:max,singleEvents:'true',orderBy:'startTime',maxResults:'250',showDeleted:'false'});
   for(const key of ['pageToken','q','timeZone'])if(q.has(key)){if(q.get(key).length>2048)fail('Invalid query');params.set(key,q.get(key));}
   return json(await call(env,base+'?'+params,undefined,'GET'));
  }
  const eventId=q.get('eventId');if(eventId&&eventId.length>1024)fail('Invalid event');
  if(path==='/event'&&method==='GET'&&eventId)return json(await call(env,base+'/'+enc(eventId),undefined,'GET'));
  if(path==='/events'&&method==='POST'){
   const raw=await body(request,64000),data=eventInput(raw);if(raw.id!==undefined){if(!/^[a-f0-9]{32}$/.test(raw.id))fail('Invalid event ID');data.id=raw.id;}return json(await call(env,base+'?sendUpdates=all&conferenceDataVersion=1',data),201);
  }
  if(path==='/event'&&['PATCH','DELETE'].includes(method)&&eventId){
   const input=await body(request,64000),current=await call(env,base+'/'+enc(eventId),undefined,'GET');
   if(current.extendedProperties?.private?.bookingId)return json({error:'Manage this event through Booking Manager to keep its booking in sync.'},409);
   if(!input.etag||input.etag!==current.etag)return json({error:'This event changed. Reopen it before saving.'},412);
   const data=method==='PATCH'?eventInput(input):undefined;
   // Preserve existing responses and metadata when the guest list is edited.
   if(data?.attendees)data.attendees=data.attendees.map(a=>({...current.attendees?.find(old=>old.email.toLowerCase()===a.email.toLowerCase()),...a}));
   return json(await call(env,base+'/'+enc(eventId)+'?sendUpdates=all&conferenceDataVersion=1',data,method,{'If-Match':input.etag}));
  }
  if(path==='/rsvp'&&method==='POST'&&eventId){
   const d=await body(request),current=await call(env,base+'/'+enc(eventId),undefined,'GET');
   if(!['accepted','tentative','declined'].includes(d.responseStatus))fail('Invalid response');
   const me=current.attendees?.find(a=>a.self);if(!me)fail('No invitation for this account');
   return json(await call(env,base+'/'+enc(eventId)+'?sendUpdates=all',{attendees:[{email:me.email,responseStatus:d.responseStatus}],attendeesOmitted:true},'PATCH',{'If-Match':current.etag}));
  }
  return json({error:'Not found'},404);
 }catch(err){const status=err.status||502;return json({error:err instanceof HttpError?err.message:status===401?'Reconnect Google Calendar.':status===403?'Google Calendar permission is missing. Reauthorize the calendar connection.':status===412?'This event changed. Reopen it before saving.':status===404?'Event or calendar not found.':'Google Calendar request failed. Try again.'},status===401?409:status);}
}
