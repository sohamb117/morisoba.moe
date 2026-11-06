import {controlSession} from './control-auth.mjs';
import {digest,token} from './mimori-crypto.mjs';
import {google} from './booking-google.mjs';
const callback='https://morisoba.moe/api/control/calendar/callback';
const cookie='__Host-calendar-oauth';
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...extra}});
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function encryptionKey(env){const source=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BOOKING_GOOGLE_CLIENT_SECRET),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('morisoba-control-calendar-v1'),info:new TextEncoder().encode('oauth-storage')},source,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function seal(value,env){const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(env),new TextEncoder().encode(value));return b64(iv)+'.'+b64(cipher);}
export async function unseal(value,env){const [iv,cipher]=value.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await encryptionKey(env),unb64(cipher)));}
export async function controlGoogle(env,path,data,method='POST',headers={}){
 const saved=await env.MIMORI_DB.prepare('SELECT encrypted_token FROM control_calendar_connection WHERE id=1').first();
 if(!saved)return google(env,path,data,method,headers);
 const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:env.BOOKING_GOOGLE_CLIENT_ID,client_secret:env.BOOKING_GOOGLE_CLIENT_SECRET,refresh_token:await unseal(saved.encrypted_token,env),grant_type:'refresh_token'})});
 if(!auth.ok){const error=Error('Reconnect Google Calendar');error.status=401;throw error;}
 const {access_token}=await auth.json();const r=await fetch('https://www.googleapis.com/calendar/v3/'+path,{method,headers:{Authorization:'Bearer '+access_token,'Content-Type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});
 if(!r.ok&&!(method==='DELETE'&&[404,410].includes(r.status))){const error=Error('Calendar request failed');error.status=r.status;throw error;}return method==='DELETE'?{}:r.json();
}
export async function calendarOAuth(request,env){
 const url=new URL(request.url),db=env.MIMORI_DB;
 if(!db||!env.BOOKING_GOOGLE_CLIENT_SECRET)return json({error:'Calendar connection is not configured.'},503);
 try{
  if(url.pathname.endsWith('/connect')){
   if(request.method!=='POST')return json({error:'Method not allowed'},405);
   const session=await controlSession(request,env);if(!session)return json({error:'Sign in required'},401);
   if(request.headers.get('Origin')!==url.origin||request.headers.get('X-CSRF-Token')!==session.csrf)return json({error:'Session check failed'},403);
   if(url.origin!=='https://morisoba.moe')return json({error:'Connect Calendar from morisoba.moe.'},400);
   const state=token(),verifier=token(),challenge=b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
   await db.batch([db.prepare('DELETE FROM control_calendar_oauth WHERE expires_ms<?').bind(Date.now()),db.prepare('INSERT INTO control_calendar_oauth VALUES(?,?,?,?)').bind(digest(state),session.session_hash,await seal(verifier,env),Date.now()+600000)]);
   const params=new URLSearchParams({client_id:env.BOOKING_GOOGLE_CLIENT_ID,redirect_uri:callback,response_type:'code',access_type:'offline',prompt:'consent',include_granted_scopes:'true',scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',state,code_challenge:challenge,code_challenge_method:'S256',login_hint:env.CONTROL_OWNER_EMAIL});
   return json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+params},200,{'Set-Cookie':cookie+'='+state+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'});
  }
  if(request.method!=='GET')return json({error:'Method not allowed'},405);
  const state=url.searchParams.get('state'),browserState=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookie+'='))?.slice(cookie.length+1);
  if(!/^[a-f0-9]{64}$/.test(state||'')||browserState!==state)return json({error:'Invalid calendar authorization state.'},400);
  const row=await db.prepare('DELETE FROM control_calendar_oauth WHERE state_hash=? AND expires_ms>? RETURNING session_hash,encrypted_verifier').bind(digest(state),Date.now()).first();
  if(!row)return json({error:'Calendar authorization expired. Start again.'},400);
  const session=await db.prepare("SELECT s.owner_id FROM control_sessions s JOIN mimori_users u ON u.id=s.owner_id WHERE s.token_hash=? AND s.expires_ms>? AND u.id=? AND u.role='admin' AND u.disabled=0").bind(row.session_hash,Date.now(),env.CONTROL_OWNER_ID).first();
  if(!session)return json({error:'Sign in and reconnect Calendar.'},401);
  if(url.searchParams.has('error')||!url.searchParams.get('code'))return Response.redirect('https://morisoba.moe/control/#calendar-cancelled',303);
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:env.BOOKING_GOOGLE_CLIENT_ID,client_secret:env.BOOKING_GOOGLE_CLIENT_SECRET,code:url.searchParams.get('code'),code_verifier:await unseal(row.encrypted_verifier,env),redirect_uri:callback,grant_type:'authorization_code'})});
  if(!r.ok)return json({error:'Google authorization failed. Reconnect Calendar.'},400);
  const auth=await r.json();if(!auth.scope?.split(' ').some(s=>['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar'].includes(s)))return json({error:'Allow event access when reconnecting Calendar.'},403);if(!auth.refresh_token)return json({error:'Google did not grant offline access. Reconnect Calendar.'},400);
  // Verify the connected account before replacing the calendar-only credential.
  const check=await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList/primary',{headers:{Authorization:'Bearer '+auth.access_token}});const primary=await check.json();
  if(!check.ok||primary.id?.toLowerCase()!==env.CONTROL_OWNER_EMAIL?.toLowerCase())return json({error:'Connect the owner’s Google account and allow calendar-list access.'},403);
  await db.prepare('INSERT INTO control_calendar_connection VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_token=excluded.encrypted_token,updated_ms=excluded.updated_ms').bind(await seal(auth.refresh_token,env),Date.now()).run();
  return new Response(null,{status:303,headers:{Location:'https://morisoba.moe/control/#calendar-connected','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':cookie+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});
 }catch{return json({error:'Calendar connection failed. Try again.'},502);}
}
