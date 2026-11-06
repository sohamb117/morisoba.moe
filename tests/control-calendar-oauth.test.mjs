import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {calendarOAuth,seal,unseal} from '../middleware/control-calendar-oauth.mjs';
import {digest} from '../middleware/mimori-crypto.mjs';
test('calendar credential encryption is randomized, authenticated and bound to the server secret',async()=>{
 const env={BOOKING_GOOGLE_CLIENT_SECRET:'test-only-secret'};const a=await seal('test-token',env),b=await seal('test-token',env);assert.notEqual(a,b);assert.equal(await unseal(a,env),'test-token');await assert.rejects(()=>unseal(a,{BOOKING_GOOGLE_CLIENT_SECRET:'wrong'}));await assert.rejects(()=>unseal(a.slice(0,-3)+'AAA',env));
});
test('calendar reconnect requires owner session, CSRF, browser-bound state, PKCE and same owner Google account',async()=>{
 const sql=new DatabaseSync(':memory:');for(const f of ['0001_mimorigasaka.sql','0009_control_sessions.sql','0010_control_calendar.sql'])sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 const raw='a'.repeat(64);sql.exec("INSERT INTO mimori_invites(token_hash,role,created_at,expires_at) VALUES('i','admin',1,9999999999999); INSERT INTO mimori_users(id,username,display_name,password_hash,role,registration_invite,created_at) VALUES('owner','owner','Owner','hash','admin','i',1)");sql.prepare('INSERT INTO control_sessions VALUES(?,?,?,?,?,?)').run(digest(raw),'owner','uid','csrf',Date.now()+3600000,Date.now());
 function stmt(q,args=[]){return {q,args,bind(...v){return stmt(q,v);},async first(){return sql.prepare(q).get(...args)||null;},async run(){return sql.prepare(q).run(...args);}};}
 const env={BOOKING_GOOGLE_CLIENT_SECRET:'test',BOOKING_GOOGLE_CLIENT_ID:'client',CONTROL_AUTH_REQUIRED:'true',CONTROL_OWNER_ID:'owner',CONTROL_GCP_UID:'uid',CONTROL_OWNER_EMAIL:'owner@example.test',MIMORI_DB:{prepare:stmt,async batch(items){return items.map(x=>sql.prepare(x.q).run(...x.args));}}};
 const request=(path,method='GET',headers={})=>new Request('https://morisoba.moe/api/control/calendar'+path,{method,headers:{Origin:'https://morisoba.moe',Cookie:'__Host-control='+raw,'X-CSRF-Token':'csrf',...headers}});
 const original=globalThis.fetch;try{
  assert.equal((await calendarOAuth(request('/connect','POST',{'X-CSRF-Token':'bad'}),env)).status,403);
  const start=await calendarOAuth(request('/connect','POST'),env),url=new URL((await start.json()).url),state=url.searchParams.get('state');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('include_granted_scopes'),'false');assert.match(url.searchParams.get('scope'),/calendar.calendarlist.readonly/);
  assert.equal((await calendarOAuth(request('/callback?state='+state+'&code=test'),env)).status,400);
  let calls=0;globalThis.fetch=async(url,opts)=>{calls++;if(String(url).includes('/token')){assert.ok(opts.body.get('code_verifier'));return Response.json({access_token:'mock-access',refresh_token:'mock-refresh',scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly'});}return Response.json({id:'owner@example.test'});};
  const callback='/callback?state='+state+'&code=test',headers={Cookie:'__Host-calendar-oauth='+state};const done=await calendarOAuth(request(callback,'GET',headers),env);assert.equal(done.status,303);assert.equal(calls,2);const row=sql.prepare('SELECT encrypted_token FROM control_calendar_connection').get();assert.equal(await unseal(row.encrypted_token,env),'mock-refresh');assert.equal((await calendarOAuth(request(callback,'GET',headers),env)).status,400);
 }finally{globalThis.fetch=original;sql.close();}
});
