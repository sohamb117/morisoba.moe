import {digest} from './mimori-crypto.mjs';
import {HttpError} from './booking-admin.mjs';
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
