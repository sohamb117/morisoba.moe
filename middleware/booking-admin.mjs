import {token,digest,verifyPassword,hashPassword} from './mimori-crypto.mjs';
export const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
export async function body(request,limit=8192){
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Invalid request');
 let size=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new HttpError(413,'Request too large');}chunks.push(value);}
 const out=new Uint8Array(size);let n=0;for(const c of chunks){out.set(c,n);n+=c.length;}
 try{const d=JSON.parse(new TextDecoder().decode(out));if(!d||Array.isArray(d)||typeof d!=='object')throw Error();return d;}catch{throw new HttpError(400,'Invalid request');}
}
const COOKIE='__Host-booking';
const DAY=86400000;
export async function passwordHash(e){
 if(!e.MIMORI_DB)return null;
 const row=await e.MIMORI_DB.prepare('SELECT password_hash FROM booking_admin_credentials WHERE id=1').first();
 return row?.password_hash||e.BOOKING_ADMIN_PASSWORD_HASH||null;
}
export async function adminSession(request,e){
 if(!e.MIMORI_DB)return null;
 const hash=await passwordHash(e);if(!hash)return null;
 const raw=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
 if(!raw||!/^[a-f0-9]{64}$/.test(raw))return null;
 return e.MIMORI_DB.prepare('SELECT token_hash,csrf FROM booking_admin_sessions WHERE token_hash=? AND expires_ms>? AND password_version=?').bind(digest(raw),Date.now(),digest(hash)).first();
}
export function validateType(d){
 const slug=String(d.slug||''),title=String(d.title||'').trim(),description=String(d.description||'').trim(),location=String(d.location||'').trim(),timezone=String(d.timezone||'');
 const reserved=['default','admin','api','book','shared','signin-with-chatgpt','signout-with-chatgpt','callback'];
 if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)||reserved.includes(slug))throw new HttpError(400,'Use lowercase letters, numbers, hyphens or underscores. Start with a letter or number.');
 if(!title||title.length>100||description.length>500||location.length>200)throw new HttpError(400,'Check the title, description and location.');
 try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format();}catch{throw new HttpError(400,'Choose a valid timezone.');}
 if(![15,30,45,60,90,120].includes(d.duration)||!Number.isInteger(d.startMinute)||!Number.isInteger(d.endMinute)||d.startMinute<0||d.endMinute>1440||d.startMinute%15||d.endMinute%15||d.endMinute-d.startMinute<d.duration)throw new HttpError(400,'Check the duration and available hours.');
 if(!Array.isArray(d.days)||!d.days.length||d.days.some(x=>!Number.isInteger(x)||x<0||x>6)||new Set(d.days).size!==d.days.length)throw new HttpError(400,'Select at least one weekday.');
 if(!Number.isInteger(d.noticeHours)||d.noticeHours<1||d.noticeHours>168||!Number.isInteger(d.horizonDays)||d.horizonDays<1||d.horizonDays>90||d.horizonDays*24<=d.noticeHours)throw new HttpError(400,'Check the notice period and booking window.');
 return {slug,title,description,location,timezone,duration:d.duration,startMinute:d.startMinute,endMinute:d.endMinute,days:d.days,noticeHours:d.noticeHours,horizonDays:d.horizonDays,enabled:d.enabled!==false};
}
export function typeView(row){if(!row)return null;const t=JSON.parse(row.settings);return {...t,slug:row.slug,enabled:!!row.enabled};}
export async function throttle(db,key,limit,window=900000){
 const bucket=Math.floor(Date.now()/window);
 await db.prepare('DELETE FROM booking_rate_limits WHERE bucket<?').bind(bucket-2).run();
 const r=await db.prepare('INSERT INTO booking_rate_limits(key,bucket,attempts) VALUES(?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,bucket).first();
 if(r.attempts>limit)throw new HttpError(429,'Too many attempts. Try again later.');
}
export async function adminApi(request,e){
 const u=new URL(request.url),path=u.pathname.slice('/api/booking/admin'.length),db=e.MIMORI_DB;
 if(!db)return json({error:'Portal storage is not configured.'},503);
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==u.origin)return json({error:'Invalid origin'},403);
 const activeHash=await passwordHash(e),configured=!!activeHash;
 if(path==='/session'&&request.method==='GET'){const s=await adminSession(request,e);return json({authenticated:!!s,configured,...(s?{csrf:s.csrf}:{} )});}
 if(!configured)return json({error:'Set the admin password before opening the portal.'},503);
 if(path==='/login'&&request.method==='POST'){
 const d=await body(request,2048);await throttle(db,'login:'+digest(request.headers.get('CF-Connecting-IP')||'unknown'),8);
 if(typeof d.password!=='string'||d.password.length>512||!await verifyPassword(d.password,activeHash))return json({error:'Incorrect password'},401);
 const raw=token(),csrf=token();
 await db.batch([db.prepare('DELETE FROM booking_admin_sessions WHERE expires_ms<=? OR password_version!=?').bind(Date.now(),digest(activeHash)),db.prepare('DELETE FROM booking_rate_limits WHERE bucket<?').bind(Math.floor(Date.now()/900000)-2),db.prepare('INSERT INTO booking_admin_sessions(token_hash,csrf,expires_ms,password_version) VALUES(?,?,?,?)').bind(digest(raw),csrf,Date.now()+DAY,digest(activeHash))]);
 return json({csrf},200,{'Set-Cookie':COOKIE+'='+raw+'; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=86400'});
 }
 const s=await adminSession(request,e);if(!s)return json({error:'Sign in required'},401);
 if(request.method!=='GET'&&request.headers.get('X-CSRF-Token')!==s.csrf)return json({error:'Session check failed. Reload and try again.'},403);
 if(path==='/password'&&request.method==='POST'){
 const d=await body(request,8192);await throttle(db,'password:'+s.token_hash,8);
 if(typeof d.currentPassword!=='string'||d.currentPassword.length>512||!await verifyPassword(d.currentPassword,activeHash))return json({error:'Incorrect current password'},400);
 if(typeof d.newPassword!=='string'||d.newPassword.length<16||d.newPassword.length>512)return json({error:'Use a password of 16–512 characters.'},400);
 if(d.newPassword!==d.confirmPassword)return json({error:'New passwords do not match.'},400);
 const hash=await hashPassword(d.newPassword),version=digest(hash);
 const changed=await db.batch([
 db.prepare('INSERT INTO booking_admin_credentials(id,password_hash) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash WHERE booking_admin_credentials.password_hash=? RETURNING id').bind(hash,activeHash),
 db.prepare('DELETE FROM booking_admin_sessions WHERE password_version!=? AND EXISTS(SELECT 1 FROM booking_admin_credentials WHERE id=1 AND password_hash=?)').bind(version,hash)
 ]);
 if(!changed[0].results.length)return json({error:'The password changed in another session. Sign in again.'},409);
 return json({changed:true},200,{'Set-Cookie':COOKIE+'=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0'});
 }
 if(path==='/logout'&&request.method==='POST'){await db.prepare('DELETE FROM booking_admin_sessions WHERE token_hash=?').bind(s.token_hash).run();return json({ok:true},200,{'Set-Cookie':COOKIE+'=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0'});}
 if(path==='/types'&&request.method==='GET'){const {results}=await db.prepare('SELECT slug,settings,enabled FROM booking_types ORDER BY created_ms').all();return json({types:results.map(typeView)});}
 if(path==='/types'&&request.method==='POST'){
 const t=validateType(await body(request));const r=await db.prepare('INSERT INTO booking_types(slug,settings,enabled,created_ms,updated_ms) VALUES(?,?,?,?,?) ON CONFLICT(slug) DO NOTHING RETURNING slug').bind(t.slug,JSON.stringify(t),+t.enabled,Date.now(),Date.now()).first();
 if(!r)return json({error:'That booking name is already used.'},409);return json({type:t},201);
 }
 const match=/^\/types\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(path);
 if(match&&request.method==='PUT'){
 const d=await body(request),t=validateType({...d,slug:match[1]});
 const r=await db.prepare('UPDATE booking_types SET settings=?,enabled=?,updated_ms=? WHERE slug=? RETURNING slug').bind(JSON.stringify(t),+t.enabled,Date.now(),t.slug).first();
 return r?json({type:t}):json({error:'Booking page not found'},404);
 }
 return json({error:'Not found'},404);
}
