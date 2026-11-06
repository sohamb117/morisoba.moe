import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {controlAuthApi,controlSession,validateGoogleClaims,verifyTokenSignature} from '../middleware/control-auth.mjs';
import {adminApi,adminSession} from '../middleware/booking-admin.mjs';
import {session as communitySession,mimorigasakaMiddleware} from '../middleware/mimorigasaka.mjs';
import {digest,hashPassword} from '../middleware/mimori-crypto.mjs';
let sql,env;
function statement(q,args=[]){return {bind(...v){return statement(q,v);},async first(){return sql.prepare(q).get(...args)||null;},async all(){return {results:sql.prepare(q).all(...args)};},async run(){return sql.prepare(q).run(...args);},q,args};}
const origin='https://morisoba.moe';
const claims=()=>({sub:'owner-gcp',email:'owner@example.com',email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'password'}});
beforeEach(async()=>{
 sql=new DatabaseSync(':memory:');for(const n of ['0001_mimorigasaka.sql','0002_identity_vaults.sql','0003_booking.sql','0004_booking_portal.sql','0005_booking_password.sql','0009_control_sessions.sql'])sql.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 env={CONTROL_AUTH_REQUIRED:'true',CONTROL_OWNER_ID:'owner',CONTROL_GCP_UID:'owner-gcp',CONTROL_OWNER_EMAIL:'owner@example.com',GCP_AUTH_PROJECT_ID:'test-project',GCP_AUTH_API_KEY:'test-key',MIMORI_ORIGIN:origin,MIMORI_DB:{prepare:statement,async batch(items){return items.map(s=>({results:sql.prepare(s.q).all(...s.args)}));}}};
 sql.prepare("INSERT INTO mimori_invites(token_hash,role,created_at,expires_at) VALUES('invite','admin',1,9999999999999)").run();
 sql.prepare("INSERT INTO mimori_users(id,username,display_name,password_hash,role,registration_invite,created_at) VALUES('owner','morisoba','Owner',?,'admin','invite',1)").run(await hashPassword('test-only-passphrase'));
});
afterEach(()=>sql.close());
function req(path,{method='GET',data,cookie,csrf,origin:from=origin}={}){return new Request(origin+path,{method,headers:{Origin:from,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});}
async function login(){const r=await controlAuthApi(req('/api/control/login',{method:'POST',data:{idToken:'test'}}),env,{verify:async()=>claims()});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf};}
test('claims require exact UID, email, password provider, verification and recent authentication',()=>{
 validateGoogleClaims(claims(),env);
 for(const patch of [{sub:'other'},{email:'stranger@example.com'},{email_verified:false},{firebase:{sign_in_provider:'google.com'}},{auth_time:1},{auth_time:Date.now()}])assert.throws(()=>validateGoogleClaims({...claims(),...patch},env));
});
test('forged token and cross-origin login cannot create sessions',async()=>{
 assert.equal((await controlAuthApi(req('/api/control/login',{method:'POST',data:{idToken:'fake'}}),env,{verify:async()=>{throw Error();}})).status,403);
 assert.equal((await controlAuthApi(req('/api/control/login',{method:'POST',origin:'https://evil.test',data:{idToken:'fake'}}),env)).status,403);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM control_sessions').get().n,0);
});
test('one opaque session authorizes calendar and community; logout revokes both',async()=>{
 const actor=await login(),r=req('/api/control/session',actor),s=await controlSession(r,env);assert.equal(s.id,'owner');assert.notEqual(s.token_hash,actor.cookie.split('=')[1]);assert.ok((await adminSession(r,env)).csrf===actor.csrf);assert.equal((await communitySession(r,env)).id,'owner');
 assert.equal((await adminApi(req('/api/booking/admin/types',actor),env)).status,200);
 assert.equal((await mimorigasakaMiddleware(req('/api/mimorigasaka/members',actor),env,()=>new Response())).status,200);
 assert.equal((await controlAuthApi(req('/api/control/logout',{...actor,method:'POST',data:{},csrf:undefined}),env)).status,403);
 assert.equal((await controlAuthApi(req('/api/control/logout',{...actor,method:'POST',data:{}}),env)).status,200);
 assert.equal(await adminSession(r,env),null);assert.equal(await communitySession(r,env),null);
});
test('expired sessions and disabled owners lose all access',async()=>{
 const actor=await login(),r=req('/api/control/session',actor);sql.prepare('UPDATE control_sessions SET expires_ms=0').run();assert.equal(await controlSession(r,env),null);
 const fresh=await login();sql.prepare("UPDATE mimori_users SET disabled=1 WHERE id='owner'").run();assert.equal(await controlSession(req('/api/control/session',fresh),env),null);
});
test('old calendar and community owner password sessions cannot bypass GCP',async()=>{
 assert.equal((await adminApi(req('/api/booking/admin/login',{method:'POST',data:{password:'test-only-passphrase'}}),env)).status,410);
 const raw='a'.repeat(64);sql.prepare('INSERT INTO mimori_sessions VALUES(?,?,?,?)').run(digest(raw),'owner','csrf',Date.now()+60000);
 assert.equal(await communitySession(req('/api/mimorigasaka/session',{cookie:'__Host-mimori='+raw}),env),null);
 const r=await mimorigasakaMiddleware(req('/api/mimorigasaka/login',{method:'POST',data:{username:'morisoba',password:'test-only-passphrase'}}),env,()=>new Response());assert.equal(r.status,403);
});
test('calendar mutations still require CSRF with unified session',async()=>{const a=await login();assert.equal((await adminApi(req('/api/booking/admin/types',{cookie:a.cookie,method:'POST',data:{}}),env)).status,403);});

test('GCP token signature, issuer, audience and expiry are verified cryptographically',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk={...await exportJWK(publicKey),kid:'test',alg:'RS256'};const resolver=createLocalJWKSet({keys:[jwk]});
 const signed=async(patch={})=>new SignJWT({...claims(),...patch}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuedAt().setIssuer('https://securetoken.google.com/test-project').setAudience('test-project').setExpirationTime('5m').sign(privateKey);
 assert.equal((await verifyTokenSignature(await signed(),env,resolver)).sub,'owner-gcp');
 const token=await signed();const parts=token.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);await assert.rejects(()=>verifyTokenSignature(parts.join('.'),env,resolver));
 const wrongAudience={...env,GCP_AUTH_PROJECT_ID:'another-project'};await assert.rejects(async()=>verifyTokenSignature(await signed(),wrongAudience,resolver));
 const expired=await new SignJWT(claims()).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuedAt().setIssuer('https://securetoken.google.com/test-project').setAudience('test-project').setExpirationTime(1).sign(privateKey);await assert.rejects(()=>verifyTokenSignature(expired,env,resolver));
 const bad=await signed({sub:'attacker'});await assert.rejects(()=>verifyTokenSignature(bad,env,resolver));
});
