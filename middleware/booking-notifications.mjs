import {googleAccessToken} from './booking-google.mjs';
import {reminderMessage} from './booking-reminders.mjs';
import {digest} from './mimori-crypto.mjs';

// Calendar invitations target attendees. Send a separate receipt to the host,
// including when the host books a test appointment with their own address.
export async function notifyBookingHost(e,{event,start,timezone,cancelToken,name,email,notes}){
 const recipient=event.organizer?.email||e.BOOKING_CALENDAR_ID;
 const key=[event.id,start,'host-booked',digest(recipient.toLowerCase())],db=e.MIMORI_DB;
 try{
  const claim=await db.prepare("INSERT INTO booking_reminder_deliveries(reservation_id,start_ms,kind,recipient_hash,status,created_ms) VALUES(?,?,?,?,'sending',?) ON CONFLICT DO NOTHING RETURNING reservation_id").bind(...key,Date.now()).first();
  if(!claim)return;
  const when=new Intl.DateTimeFormat('en-US',{timeZone:timezone,dateStyle:'full',timeStyle:'short'}).format(new Date(start))+' ('+timezone+')';
  const meeting=event.hangoutLink||event.conferenceData?.entryPoints?.find(p=>p.entryPointType==='video')?.uri||event.location||'';
  const link='https://'+(e.BOOKING_HOST||'calendar.morisoba.moe')+'/manage#token='+cancelToken;
  const text=['You have a new booking.',event.summary,'Guest: '+name+' <'+email+'>',when,meeting,notes?'Guest notes: '+notes:'','Manage booking: '+link].filter(Boolean).join('\n\n');
  const raw=reminderMessage({recipient,subject:'New booking: '+event.summary,text,id:digest(key.join(':'))});
  const access=await googleAccessToken(e);
  const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({raw})});
  if(!response.ok)throw Error('Host email was not accepted');
  await db.prepare("UPDATE booking_reminder_deliveries SET status='sent',sent_ms=? WHERE reservation_id=? AND start_ms=? AND kind=? AND recipient_hash=?").bind(Date.now(),...key).run();
 }catch{
  // An email failure must not turn a successfully created event into a failed
  // booking and encourage a duplicate. Retain the failure for the admin screen.
  console.error('Booking host email needs attention',{bookingId:event.id});
  try{await db.prepare("UPDATE booking_reminder_deliveries SET status='failed' WHERE reservation_id=? AND start_ms=? AND kind=? AND recipient_hash=?").bind(...key).run();}catch{}
 }
}
