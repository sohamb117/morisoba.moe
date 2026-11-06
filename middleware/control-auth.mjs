import {createRemoteJWKSet,jwtVerify} from 'jose';
import {digest,token} from './mimori-crypto.mjs';
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const cookie='__Host-control';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{...headers,...extra}});
const expired=`${cookie}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`;
export const googleAuthEnabled=e=>e.CONTROL_AUTH_REQUIRED==='true';
export async function controlSession(request,e){
 if(!googleAuthEnabled(e)||!e.CONTROL_OWNER_ID||!e.MIMORI_DB)return null;
 const raw=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookie+'='))?.slice(cookie.length+1);
 if(!/^[a-f0-9]{64}$/.test(raw||''))return null;
 return e.MIMORI_DB.prepare("SELECT u.*,s.csrf,s.token_hash AS session_hash,s.token_hash,s.google_uid,s.expires_ms FROM control_sessions s JOIN mimori_users u ON u.id=s.owner_id WHERE s.token_hash=? AND s.expires_ms>? AND u.id=? AND s.google_uid=? AND u.role='admin' AND u.disabled=0").bind(digest(raw),Date.now(),e.CONTROL_OWNER_ID,e.CONTROL_GCP_UID).first();
}
export function validateGoogleClaims(p,e,now=Date.now()){
 if(!p.sub||p.sub.length>128||p.email_verified!==true||p.email?.toLowerCase()!==e.CONTROL_OWNER_EMAIL?.toLowerCase()||p.firebase?.sign_in_provider!=='password'||p.sub!==e.CONTROL_GCP_UID||!Number.isFinite(p.auth_time)||p.auth_time*1000>now+30000||p.auth_time*1000<now-300000)throw Error('Owner access required');
}
export async function verifyTokenSignature(raw,e,resolver=keys){
 const {payload}=await jwtVerify(raw,resolver,{issuer:'https://securetoken.google.com/'+e.GCP_AUTH_PROJECT_ID,audience:e.GCP_AUTH_PROJECT_ID,algorithms:['RS256'],requiredClaims:['sub','iat','exp','auth_time']});
 validateGoogleClaims(payload,e);return payload;
}
export async function verifyGoogleToken(raw,e){
 const payload=await verifyTokenSignature(raw,e);
 // Lookup checks that this is a current, enabled Identity Platform account.
 const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(e.GCP_AUTH_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:raw})});
 if(!response.ok)throw Error('Invalid Google session');
 const record=(await response.json()).users?.find(u=>u.localId===payload.sub);
 if(!record||record.disabled||Number(record.validSince||0)>payload.auth_time)throw Error('Invalid Google session');
 return payload;
}
export async function controlAuthApi(request,e,{verify=verifyGoogleToken}={}){
 const u=new URL(request.url),route=u.pathname.slice('/api/control'.length),method=request.method;
 if(method!=='GET'&&(request.headers.get('Origin')!==u.origin||request.headers.get('Sec-Fetch-Site')==='cross-site'))return json({error:'Invalid origin'},403);
 if(!googleAuthEnabled(e))return json({error:'Sign-in is not configured.'},503);
 try{
 if(route==='/config'&&method==='GET')return json({apiKey:e.GCP_AUTH_API_KEY,authDomain:e.GCP_AUTH_DOMAIN,projectId:e.GCP_AUTH_PROJECT_ID,username:e.CONTROL_USERNAME,email:e.CONTROL_OWNER_EMAIL});
 if(route==='/login'&&method==='POST'){
  if(!e.GCP_AUTH_PROJECT_ID||!e.GCP_AUTH_API_KEY||!e.CONTROL_OWNER_ID||!e.CONTROL_OWNER_EMAIL)return json({error:'Sign-in is not configured.'},503);
  const ip=digest(request.headers.get('CF-Connecting-IP')||'unknown'),bucket=Math.floor(Date.now()/900000);
  const rate=await e.MIMORI_DB.prepare('INSERT INTO booking_rate_limits(key,bucket,attempts) VALUES(?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind('control:'+ip,bucket).first();
  if(rate.attempts>12)return json({error:'Too many attempts. Try again later.'},429);
  const reader=request.body?.getReader();if(!reader)return json({error:'Invalid request'},400);let size=0,chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16000){await reader.cancel();return json({error:'Request too large'},413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'Invalid request'},400);}
  if(typeof data?.idToken!=='string'||data.idToken.length>14000)return json({error:'Invalid token'},400);
  let claims;try{claims=await verify(data.idToken,e);}catch{return json({error:'Owner access required.'},403);}
  const owner=await e.MIMORI_DB.prepare("SELECT id FROM mimori_users WHERE id=? AND role='admin' AND disabled=0").bind(e.CONTROL_OWNER_ID).first();
  if(!owner)return json({error:'Owner access is not configured.'},403);
  const raw=token(),csrf=token(),now=Date.now();
  await e.MIMORI_DB.batch([e.MIMORI_DB.prepare('DELETE FROM control_sessions WHERE expires_ms<=?').bind(now),e.MIMORI_DB.prepare('INSERT INTO control_sessions VALUES(?,?,?,?,?,?)').bind(digest(raw),owner.id,claims.sub,csrf,now+3600000,now)]);
  return json({csrf},200,{'Set-Cookie':`${cookie}=${raw}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=3600`});
 }
 const s=await controlSession(request,e);
 if(route==='/session'&&method==='GET')return json(s?{authenticated:true,csrf:s.csrf,user:{id:s.id,username:s.username,displayName:s.display_name,bio:s.bio,email:e.CONTROL_OWNER_EMAIL}}:{authenticated:false});
 if(!s)return json({error:'Sign in required'},401);
 if(method!=='GET'&&request.headers.get('X-CSRF-Token')!==s.csrf)return json({error:'Session check failed'},403);
 if(['/logout','/logout-all'].includes(route)&&method==='POST'){await e.MIMORI_DB.prepare(route==='/logout-all'?'DELETE FROM control_sessions WHERE owner_id=?':'DELETE FROM control_sessions WHERE token_hash=?').bind(route==='/logout-all'?s.id:s.token_hash).run();return json({ok:true},200,{'Set-Cookie':expired});}
 return json({error:'Not found'},404);
 }catch{console.error('Control authentication request failed');return json({error:'Sign-in unavailable. Try again.'},503);}
}
