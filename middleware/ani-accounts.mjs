import {controlSession} from './control-auth.mjs';
import {digest,token,hashPassword,verifyPassword} from './mimori-crypto.mjs';
const cookie='__Host-ani';
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...headers}});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
function password(value){if(typeof value!=='string'||value.length<12||value.length>256)fail(400,'Use a password between 12 and 256 characters.');return value;}
export function accountName(value){if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/.test(value))fail(400,'Use 3–32 letters, numbers, underscores or hyphens.');return value.toLowerCase();}
async function body(request){if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'Expected JSON');const reader=request.body?.getReader();if(!reader)fail(400,'Missing request');let size=0,parts=[];try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>4096)fail(413,'Request too large');parts.push(r.value);}}finally{await reader.cancel();}const data=new Uint8Array(size);let at=0;for(const p of parts){data.set(p,at);at+=p.length;}try{return JSON.parse(new TextDecoder().decode(data));}catch{fail(400,'Invalid JSON');}}
function sameOrigin(request){if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'Invalid origin');}
export async function aniSession(request,env){
 const raw=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookie+'='))?.slice(cookie.length+1);
 if(!/^[a-f0-9]{64}$/.test(raw||''))return null;
 return env.MIMORI_DB.prepare('SELECT a.id,a.username,s.csrf FROM ani_sessions s JOIN ani_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>? AND a.disabled=0').bind(digest(raw),Date.now()).first();
}
export async function aniAuthApi(request,env){
 const route=new URL(request.url).pathname,db=env.MIMORI_DB;
 try{
 if(route==='/api/ani/session'&&request.method==='GET'){const s=await aniSession(request,env);return json(s?{authenticated:true,username:s.username,csrf:s.csrf}:{authenticated:false});}
 if(request.method!=='POST')return json({error:'Not found'},404);
 sameOrigin(request);
 if(route==='/api/ani/login'){
  const data=await body(request),name=accountName(data.username),pass=password(data.password),bucket=Math.floor(Date.now()/900000);
  for(const key of ['ip:'+digest(request.headers.get('CF-Connecting-IP')||'unknown'),'user:'+digest(name)]){
   const row=await db.prepare('INSERT INTO ani_login_limits(key,bucket,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN bucket=excluded.bucket THEN attempts+1 ELSE 1 END,bucket=excluded.bucket RETURNING attempts').bind(key,bucket).first();
   if(row.attempts>20)return json({error:'Too many attempts. Try again later.'},429);
  }
  const account=await db.prepare('SELECT * FROM ani_accounts WHERE username=?').bind(name).first();
  if(!await verifyPassword(pass,account?.password_hash)||!account||account.disabled)return json({error:'Username or password is incorrect.'},401);
  const raw=token(),csrf=token(),now=Date.now();
  // Guard against an admin disabling/resetting the account while password verification runs.
  const added=await db.prepare('INSERT INTO ani_sessions(token_hash,account_id,csrf,expires_at) SELECT ?,id,?,? FROM ani_accounts WHERE id=? AND disabled=0 AND password_hash=? RETURNING account_id').bind(digest(raw),csrf,now+7*86400000,account.id,account.password_hash).first();
  if(!added)return json({error:'Username or password is incorrect.'},401);
  await db.prepare('DELETE FROM ani_sessions WHERE expires_at<=?').bind(now).run();
  return json({authenticated:true,username:account.username,csrf},200,{'Set-Cookie':`${cookie}=${raw}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=604800`});
 }
 if(route==='/api/ani/logout'){
  const s=await aniSession(request,env);if(!s)return json({error:'Sign in required'},401);if(request.headers.get('X-CSRF-Token')!==s.csrf)fail(403,'Session check failed');
  await db.prepare('DELETE FROM ani_sessions WHERE account_id=? AND csrf=?').bind(s.id,s.csrf).run();
  return json({ok:true},200,{'Set-Cookie':`${cookie}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`});
 }
 return json({error:'Not found'},404);
 }catch(e){return json({error:e.status?e.message:'Account service unavailable.'},e.status||503);}
}
export async function aniAccountsApi(request,env,{authenticate=controlSession}={}){
 try{
 const owner=await authenticate(request,env);if(!owner)return json({error:'Sign in required'},401);
 const db=env.MIMORI_DB;
 if(request.method==='GET')return json({accounts:(await db.prepare('SELECT id,username,disabled,created_at FROM ani_accounts ORDER BY created_at DESC').all()).results});
 sameOrigin(request);if(request.headers.get('X-CSRF-Token')!==owner.csrf)fail(403,'Session check failed');
 const data=await body(request);
 if(request.method==='POST'){
  const name=accountName(data.username);if(name===(env.CONTROL_USERNAME||'morisoba').toLowerCase())fail(400,'This username is reserved.');
  const hash=await hashPassword(password(data.password)),id=crypto.randomUUID();
  const row=await db.prepare('INSERT INTO ani_accounts(id,username,password_hash,created_at) VALUES(?,?,?,?) ON CONFLICT(username) DO NOTHING RETURNING id,username,disabled,created_at').bind(id,name,hash,Date.now()).first();
  if(!row)fail(409,'Username is already in use.');return json({account:row},201);
 }
 if(request.method==='PATCH'){
  if(typeof data.id!=='string'||data.id.length>64)fail(400,'Invalid account');
  const account=await db.prepare('SELECT id FROM ani_accounts WHERE id=?').bind(data.id).first();if(!account)fail(404,'Account not found');
  if(typeof data.disabled==='boolean')await db.batch([db.prepare('UPDATE ani_accounts SET disabled=? WHERE id=?').bind(Number(data.disabled),data.id),db.prepare('DELETE FROM ani_sessions WHERE account_id=?').bind(data.id)]);
  else if(data.password!==undefined){const hash=await hashPassword(password(data.password));await db.batch([db.prepare('UPDATE ani_accounts SET password_hash=? WHERE id=?').bind(hash,data.id),db.prepare('DELETE FROM ani_sessions WHERE account_id=?').bind(data.id)]);}
  else fail(400,'Choose an account change');
  return json({ok:true});
 }
 return json({error:'Method not allowed'},405);
 }catch(e){return json({error:e.status?e.message:'Account service unavailable.'},e.status||503);}
}
