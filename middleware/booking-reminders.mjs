import {Buffer} from 'node:buffer';
import {configured,google,googleAccessToken} from './booking-google.mjs';
import {digest} from './mimori-crypto.mjs';
export function reminderKind(row,now){
 const remaining=row.start_ms-now;
 if(remaining<=0)return null;
 if(remaining<=3600000&&row.created_ms<=row.start_ms-3600000)return '1h';
 if(remaining<=86400000&&remaining>3600000&&row.created_ms<=row.start_ms-86400000)return '24h';
 return null;
}
export function reminderMessage({recipient,subject,text,id}){
 if(!/^[^\s<>\r\n]+@[^\s<>\r\n]+$/.test(recipient))throw Error('Invalid reminder recipient');
 const encoded=Buffer.from(subject.replace(/[\r\n]/g,' ')).toString('base64');
 return Buffer.from(['To: '+recipient,'Subject: =?UTF-8?B?'+encoded+'?=','Message-ID: <'+id+'@calendar.morisoba.moe>','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(text).toString('base64').match(/.{1,76}/g).join('\r\n')].join('\r\n')).toString('base64url');
}
export async function sendBookingReminders(e,now=Date.now()){
 if(!configured(e))return {sent:0,failed:0};
 const db=e.MIMORI_DB,{results}=await db.prepare("SELECT r.*,t.settings FROM booking_reservations r LEFT JOIN booking_types t ON t.slug=r.booking_slug WHERE r.status='confirmed' AND r.reminders=1 AND r.start_ms>? AND r.start_ms<=? AND NOT EXISTS(SELECT 1 FROM booking_operations o WHERE o.reservation_id=r.id) ORDER BY r.start_ms LIMIT 100").bind(now,now+86400000).all();
 let sent=0,failed=0;
 for(const row of results){
  const kind=reminderKind(row,now);if(!kind)continue;
  try{
   const event=await google(e,'calendars/'+encodeURIComponent(row.calendar_id||e.BOOKING_CALENDAR_ID)+'/events/'+row.id,null,'GET');
   if(event.status==='cancelled'||Date.parse(event.start?.dateTime)!==row.start_ms)continue;
   const settings=row.settings?JSON.parse(row.settings):{},zone=settings.timezone||'America/New_York';
   const when=new Intl.DateTimeFormat('en-US',{timeZone:zone,dateStyle:'full',timeStyle:'short'}).format(new Date(row.start_ms))+' ('+zone+')';
   const meeting=event.hangoutLink||event.conferenceData?.entryPoints?.find(p=>p.entryPointType==='video')?.uri||event.location||'';
   const link='https://'+(e.BOOKING_HOST||'calendar.morisoba.moe')+'/manage#token='+row.cancel_token;
   const text=[event.summary||'Meeting with Soham',when,meeting,'Reschedule or cancel: '+link,'This reminder was sent for your booking with Soham.'].filter(Boolean).join('\n\n');
   const recipients=[...new Set((event.attendees||[]).filter(a=>a.responseStatus!=='declined'&&!a.resource).map(a=>a.email).filter(Boolean))];
   for(const recipient of recipients){
    const hash=digest(recipient.toLowerCase()),key=[row.id,row.start_ms,kind,hash];
    // A durable claim prevents two cron invocations from mailing the same reminder.
    // Ambiguous sends stay claimed for operator review rather than risking duplicates.
    const claim=await db.prepare("INSERT INTO booking_reminder_deliveries(reservation_id,start_ms,kind,recipient_hash,status,created_ms) SELECT ?,?,?,?,'sending',? WHERE EXISTS(SELECT 1 FROM booking_reservations WHERE id=? AND status='confirmed' AND start_ms=?) AND NOT EXISTS(SELECT 1 FROM booking_operations WHERE reservation_id=?) ON CONFLICT DO NOTHING RETURNING reservation_id").bind(...key,now,row.id,row.start_ms,row.id).first();
    if(!claim)continue;
    try{
     const raw=reminderMessage({recipient,subject:'Reminder: '+(event.summary||'Meeting with Soham'),text,id:digest(key.join(':'))});
     const access=await googleAccessToken(e);
     const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({raw})});
     if(!response.ok)throw Error('Gmail did not accept the reminder');
     await db.prepare("UPDATE booking_reminder_deliveries SET status='sent',sent_ms=? WHERE reservation_id=? AND start_ms=? AND kind=? AND recipient_hash=?").bind(Date.now(),...key).run();sent++;
    }catch{
     await db.prepare("UPDATE booking_reminder_deliveries SET status='failed' WHERE reservation_id=? AND start_ms=? AND kind=? AND recipient_hash=?").bind(...key).run();failed++;
    }
   }
  }catch{failed++;}
 }
 if(failed)console.error('Booking reminders need attention',{failed});
 return {sent,failed};
}
