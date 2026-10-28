import {randomInt} from 'node:crypto';
import {digest} from './mimori-crypto.mjs';
import {HttpError,json} from './booking-admin.mjs';
import {googleAccessToken} from './booking-google.mjs';
import {reminderMessage} from './booking-reminders.mjs';
const MIN=60000,DAY=86400000;
export function bookingEmail(value){
 const email=String(value||'').trim().toLowerCase();
 if(email.length>254||!/^[-a-z0-9.!#$%&'*+/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(email))throw new HttpError(400,'Enter a valid email address.');
 return email;
}
export function emailKey(email){
 let [local,domain]=email.split('@');
 // Gmail aliases share an inbox and must share the booking allowance.
 if(domain==='gmail.com'||domain==='googlemail.com'){domain='gmail.com';local=local.split('+')[0].replaceAll('.','');}
 return digest(local+'@'+domain);
}
export async function abuseLimit(db,key,limit,window,now=Date.now()){
 const row=await db.prepare('INSERT INTO booking_abuse_limits(key,attempts,reset_ms) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_ms<=? THEN 1 ELSE attempts+1 END,reset_ms=CASE WHEN reset_ms<=? THEN excluded.reset_ms ELSE reset_ms END RETURNING attempts').bind(key,now+window,now,now).first();
 if(row.attempts>limit)throw new HttpError(429,'Too many requests. Please try again later.');
}
export async function requestBookingCode(request,e,d){
 const db=e.MIMORI_DB,email=bookingEmail(d.email),key=emailKey(email),now=Date.now(),ip=digest(request.headers.get('CF-Connecting-IP')||'unknown');
 if(d.website)throw new HttpError(400,'Unable to verify this request.');
 await abuseLimit(db,'verify-ip-short:'+ip,3,15*MIN,now);
 await abuseLimit(db,'verify-ip-day:'+ip,10,DAY,now);
 await abuseLimit(db,'verify-email-hour:'+key,3,60*MIN,now);
 await abuseLimit(db,'verify-email-day:'+key,6,DAY,now);
 await abuseLimit(db,'verify-global-hour',30,60*MIN,now);
 await abuseLimit(db,'verify-global-day',100,DAY,now);
 const id=crypto.randomUUID().replaceAll('-',''),code=String(randomInt(1000000)).padStart(6,'0');
 await db.prepare('DELETE FROM booking_verifications WHERE expires_ms<?').bind(now-DAY).run();
 await db.prepare('DELETE FROM booking_abuse_limits WHERE reset_ms<?').bind(now-DAY).run();
 await db.prepare('INSERT INTO booking_verifications(id,email_hash,code_hash,expires_ms) VALUES(?,?,?,?)').bind(id,digest(email),digest(id+':'+code),now+10*MIN).run();
 try{
  const raw=reminderMessage({recipient:email,subject:'Verify your email for a booking with Soham',text:'Your booking verification code is: '+code+'\n\nThis code expires in 10 minutes. Enter it on calendar.morisoba.moe to confirm your appointment. No appointment has been booked yet.\n\nIf you did not request a booking, ignore this email.',id:id+'-verify'});
  const access=await googleAccessToken(e);
  const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({raw})});
  if(!response.ok)throw Error('Email failed');
 }catch{await db.prepare('DELETE FROM booking_verifications WHERE id=?').bind(id).run();throw new HttpError(503,'Could not send the verification code. Please try again later.');}
 return json({verificationId:id,expiresIn:600});
}
export async function checkBookingCode(db,d,email){
 if(!/^[a-f0-9]{32}$/.test(String(d.verificationId||''))||!/^\d{6}$/.test(String(d.code||'')))throw new HttpError(403,'Verify your email before booking.');
 const row=await db.prepare('UPDATE booking_verifications SET attempts=attempts+1 WHERE id=? AND email_hash=? AND expires_ms>? AND consumed_ms IS NULL AND attempts<5 RETURNING code_hash').bind(d.verificationId,digest(email),Date.now()).first();
 if(!row||row.code_hash!==digest(d.verificationId+':'+d.code))throw new HttpError(403,'Invalid or expired code. Request a new code if needed.');
}
