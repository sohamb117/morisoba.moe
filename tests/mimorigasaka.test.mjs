import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {digest,token} from '../middleware/mimori-crypto.mjs';
let mf, db, owner, alice, bob;
const origin='https://morisoba.moe', password='a real test passphrase 123!';
async function request(path, {method='GET', data, actor, headers={}, raw}={}) {
  const h={...headers};if(actor){h.Cookie=actor.cookie;h['X-CSRF-Token']=actor.csrf;}
  if(method!=='GET'){h.Origin??=origin;h['Content-Type']??='application/json';}
  const response=await mf.dispatchFetch(origin+'/api/mimorigasaka'+path,{method,headers:h,body:raw??(data===undefined?undefined:JSON.stringify(data))});
  const content=response.headers.get('Content-Type')?.includes('json')?await response.json():await response.arrayBuffer();
  return {status:response.status,headers:response.headers,data:content};
}
async function seedInvite(role='member',expires=Date.now()+86400000){const raw=token();await db.prepare('INSERT INTO mimori_invites(token_hash,role,created_at,expires_at) VALUES(?,?,?,?)').bind(digest(raw),role,Date.now(),expires).run();return raw;}
async function register(username,role='member'){
 const invite=await seedInvite(role);const r=await request('/register',{method:'POST',data:{username,password,invite}});assert.equal(r.status,200,JSON.stringify(r.data));return {...r.data,cookie:r.headers.get('Set-Cookie').split(';')[0]};
}
before(async()=>{
 const bundle=await build({entryPoints:['worker.mjs'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],d1Databases:['MIMORI_DB','MIMORI_PROTOCOL_DB'],bindings:{MIMORI_ORIGIN:origin,MIMORI_PROTOCOL_ENABLED:'true'},serviceBindings:{ASSETS:()=>new Response('static')}}));
 db=await mf.getD1Database('MIMORI_DB');
 const sql=(await readFile(new URL('../migrations/0001_mimorigasaka.sql',import.meta.url),'utf8'))+(await readFile(new URL('../migrations/0002_identity_vaults.sql',import.meta.url),'utf8'));
 for(const statement of sql.split(';').filter(s=>s.trim()))await db.prepare(statement).run();
 const protocol=await mf.getD1Database('MIMORI_PROTOCOL_DB');
 for(const file of ['0001_protocol.sql','0002_archives.sql','0003_devices.sql','0004_archive_changes.sql'])for(const statement of (await readFile('protocol/migrations/'+file,'utf8')).split(';').filter(s=>s.trim()))await protocol.prepare(statement).run();
 owner=await register('morisoba','admin');alice=await register('alice');bob=await register('bob');
});
after(async()=>{await mf?.dispose();});
test('registration hashes passwords and tokens; secure cookie and no-store responses',async()=>{
 const row=await db.prepare('SELECT password_hash FROM mimori_users WHERE id=?').bind(owner.user.id).first();assert.match(row.password_hash,/^scrypt:16384:8:5:/);assert.ok(!row.password_hash.includes(password));
 const login=await request('/login',{method:'POST',data:{username:'morisoba',password}});assert.equal(login.status,200);assert.match(login.headers.get('Set-Cookie'),/__Host-mimori=.*HttpOnly; SameSite=Strict; Secure/);assert.match(login.headers.get('Cache-Control'),/no-store/);assert.equal(login.data.user.role,'admin');assert.ok(!('password_hash' in login.data.user));
 const stored=await db.prepare('SELECT token_hash FROM mimori_sessions LIMIT 1').first();assert.notEqual(stored.token_hash,owner.cookie.split('=')[1]);
});
test('anonymous feed, single post, profiles and avatar are locked by API',async()=>{
 for(const path of ['/posts','/posts/1','/avatars/'+alice.user.id,'/members','/invites'])assert.equal((await request(path)).status,401,path);
 assert.deepEqual((await request('/session')).data,{user:null});assert.equal((await request('/signup',{method:'POST',data:{}})).status,401);
});
test('no first-login signup or arbitrary role escalation',async()=>{
 assert.equal((await request('/login',{method:'POST',data:{username:'stranger',password}})).status,401);
 assert.equal((await request('/register',{method:'POST',data:{username:'stranger',password,role:'admin'}})).status,400);
 const invite=await seedInvite();const r=await request('/register',{method:'POST',data:{username:'charlie',password,invite,role:'admin'}});assert.equal(r.status,200);assert.equal(r.data.user.role,'member');
 assert.equal((await request('/register',{method:'POST',data:{username:'charlie2',password,invite}})).status,400);
});
test('expired, revoked and racing invitations cannot be reused',async()=>{
 const expired=await seedInvite('member',Date.now()-1);assert.equal((await request('/register',{method:'POST',data:{username:'expired',password,invite:expired}})).status,400);
 const revoked=await seedInvite();await db.prepare('UPDATE mimori_invites SET revoked=1 WHERE token_hash=?').bind(digest(revoked)).run();assert.equal((await request('/register',{method:'POST',data:{username:'revoked',password,invite:revoked}})).status,400);
 const invite=await seedInvite();const results=await Promise.all(['raceone','racetwo'].map(username=>request('/register',{method:'POST',headers:{'CF-Connecting-IP':username},data:{username,password,invite}})));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.ok(results.every(r=>[200,400,409].includes(r.status)));
});
test('origin and CSRF checks block cross-site and unauthenticated mutations',async()=>{
 assert.equal((await request('/posts',{method:'POST',actor:alice,headers:{Origin:'https://evil.test'},data:{body:'bad'}})).status,403);
 assert.equal((await request('/posts',{method:'POST',headers:{Cookie:alice.cookie},data:{body:'bad'}})).status,403);
 assert.equal((await request('/login',{method:'POST',headers:{Origin:'null'},data:{username:'alice',password}})).status,403);
 assert.equal((await request('/posts',{method:'POST',actor:alice,headers:{'Content-Type':'text/plain'},raw:'bad'})).status,415);
});
test('authors can create/edit/pin their own posts, never another account',async()=>{
 const created=await request('/posts',{method:'POST',actor:alice,data:{body:'hello <script>alert(1)</script>',userId:bob.user.id}});assert.equal(created.status,201);const id=created.data.id;
 const fetched=await request('/posts/'+id,{actor:bob});assert.equal(fetched.data.post.author.id,alice.user.id);assert.equal(fetched.data.post.canEdit,false);assert.match(fetched.data.post.body,/<script>/);
 assert.equal((await request('/posts/'+id,{method:'PATCH',actor:bob,data:{body:'stolen'}})).status,403);
 assert.equal((await request('/posts/'+id,{method:'DELETE',actor:bob,data:{}})).status,403);
 assert.equal((await request('/posts/'+id,{method:'PATCH',actor:owner,data:{body:'stolen'}})).status,403);
 assert.equal((await request('/posts/'+id,{method:'PATCH',actor:alice,data:{body:'edited',pinned:true}})).status,200);
 const pinned=await request('/posts?pinned=1',{actor:bob});assert.ok(pinned.data.posts.some(p=>p.id===id&&p.body==='edited'));
 assert.equal((await request('/posts/'+id,{method:'DELETE',actor:alice,data:{}})).status,200);
 assert.equal((await request('/posts/'+id,{actor:alice})).status,404);
 assert.ok((await db.prepare('SELECT deleted_at FROM mimori_posts WHERE id=?').bind(id).first()).deleted_at);
});
test('post and profile validation rejects malformed and oversized values',async()=>{
 for(const body of ['', ' '.repeat(3),'x'.repeat(2001),{html:'x'}])assert.equal((await request('/posts',{method:'POST',actor:alice,data:{body}})).status,400);
 assert.equal((await request('/posts',{method:'POST',actor:alice,raw:'{"body":'})).status,400);
 assert.equal((await request('/posts',{method:'POST',actor:alice,data:{body:'x'.repeat(17000)}})).status,413);
 assert.equal((await request('/profile',{method:'PATCH',actor:alice,data:{displayName:'',bio:''}})).status,400);
 assert.equal((await request('/profile',{method:'PATCH',actor:alice,data:{displayName:'Alice',bio:'b'.repeat(281)}})).status,400);
 assert.equal((await request('/posts?before=NaN',{actor:alice})).status,400);
});
test('profile updates cannot change role, username, or other accounts',async()=>{
 const r=await request('/profile',{method:'PATCH',actor:alice,data:{displayName:'Alice A',bio:'hello',role:'admin',username:'owner',id:bob.user.id}});assert.equal(r.status,200);assert.equal(r.data.user.role,'member');assert.equal(r.data.user.username,'alice');
 const b=await request('/session',{actor:bob});assert.equal(b.data.user.displayName,'bob');
});
test('pictures reject SVG and oversize uploads; image reads require login',async()=>{
 assert.equal((await request('/avatar',{method:'PUT',actor:alice,headers:{'Content-Type':'image/svg+xml'},raw:'<svg onload="alert(1)"/>'})).status,415);
 assert.equal((await request('/avatar',{method:'PUT',actor:alice,raw:new Uint8Array(256001)})).status,413);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=','base64');
 assert.equal((await request('/avatar',{method:'PUT',actor:alice,headers:{'Content-Type':'image/png'},raw:png})).status,200);
 assert.equal((await request('/avatars/'+alice.user.id)).status,401);
 const image=await request('/avatars/'+alice.user.id,{actor:bob});assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/png');assert.match(image.headers.get('Cache-Control'),/no-store/);
 assert.equal((await request('/avatar',{method:'DELETE',actor:alice,data:{}})).status,200);assert.equal((await request('/avatars/'+alice.user.id,{actor:bob})).status,404);
});
test('only owner manages invites and member access; disabling invalidates sessions',async()=>{
 assert.equal((await request('/invites',{method:'POST',actor:bob,data:{role:'admin'}})).status,403);
 const invite=await request('/invites',{method:'POST',actor:owner,data:{role:'admin'}});assert.equal(invite.status,201);
 const row=await db.prepare('SELECT * FROM mimori_invites WHERE token_hash=?').bind(digest(invite.data.token)).first();assert.equal(row.role,'member');
 assert.equal((await request('/invites/'+row.token_hash,{method:'DELETE',actor:owner,data:{}})).status,200);
 assert.equal((await request('/members/'+owner.user.id,{method:'PATCH',actor:owner,data:{disabled:true}})).status,403);
 assert.equal((await request('/members/'+bob.user.id,{method:'PATCH',actor:alice,data:{disabled:true}})).status,403);
 assert.equal((await request('/members/'+bob.user.id,{method:'PATCH',actor:owner,data:{disabled:true}})).status,200);
 assert.equal((await request('/posts',{actor:bob})).status,401);
 assert.equal((await request('/login',{method:'POST',data:{username:'bob',password}})).status,401);
 assert.equal((await request('/members/'+bob.user.id,{method:'PATCH',actor:owner,data:{disabled:false}})).status,200);
});
test('logout and expiration reject old sessions',async()=>{
 const account=await register('logoutuser');assert.equal((await request('/logout',{method:'POST',actor:account,data:{}})).status,200);assert.equal((await request('/posts',{actor:account})).status,401);
 await db.prepare('UPDATE mimori_sessions SET expires_at=0 WHERE user_id=?').bind(alice.user.id).run();assert.equal((await request('/posts',{actor:alice})).status,401);
});
test('password change requires current password and revokes other sessions',async()=>{
 const account=await register('passworduser');const next='a changed test passphrase 123!';
 assert.equal((await request('/password',{method:'POST',actor:account,data:{currentPassword:'not the real passcode',password:next}})).status,400);
 const r=await request('/password',{method:'POST',actor:account,data:{currentPassword:password,password:next}});assert.equal(r.status,200);assert.equal((await request('/posts',{actor:account})).status,401);
 assert.equal((await request('/login',{method:'POST',headers:{'CF-Connecting-IP':'password'},data:{username:'passworduser',password:next}})).status,200);
});
test('login throttling is durable across requests',async()=>{
 let r;for(let i=0;i<11;i++)r=await request('/login',{method:'POST',headers:{'CF-Connecting-IP':'rate-test'},data:{username:'missinguser',password}});
 assert.equal(r.status,429);assert.ok(r.headers.get('Retry-After'));
});
test('pagination returns each post once and static routes keep working',async()=>{
 const now=Date.now();for(let i=0;i<35;i++)await db.prepare('INSERT INTO mimori_posts(user_id,body,created_at,updated_at) VALUES(?,?,?,?)').bind(owner.user.id,'page '+i,now,now).run();
 const first=await request('/posts',{actor:owner});assert.equal(first.data.posts.length,30);assert.ok(first.data.next);
 const second=await request('/posts?before='+first.data.next,{actor:owner});assert.ok(second.data.posts.length>=5);assert.ok(second.data.posts.every(p=>p.id<first.data.next));
 const staticResponse=await mf.dispatchFetch(origin+'/mimorigasaka/');assert.equal(await staticResponse.text(),'static');assert.match(staticResponse.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 const home=await mf.dispatchFetch(origin+'/');assert.equal(await home.text(),'static');
});
test('Mimori rename preserves old links and serves enabled routes',async()=>{
 const old=await mf.dispatchFetch(origin+'/mimorigasaka/protocol/?request=example',{redirect:'manual'});
 assert.equal(old.status,308);assert.equal(old.headers.get('Location'),origin+'/mimori/?request=example');
 assert.equal((await mf.dispatchFetch(origin+'/mimori/')).status,200);
 assert.equal((await mf.dispatchFetch(origin+'/api/mimori/v1/records')).status,200);
});

test('account password changes preserve encryption keys and existing posts for a new browser',async()=>{
 const {ProviderClient,signInIdentity,unlock,openProtocolClient}=await import('../protocol/client.mjs');
 const {IDBFactory}=await import('fake-indexeddb');
 let actor=await register('portablepassword');
 const provider=()=>new ProviderClient(origin,{csrf:actor.csrf,fetch:async(url,init={})=>{const headers=new Headers(init.headers);if(init.credentials==='same-origin')headers.set('Cookie',actor.cookie);if(init.method!=='GET')headers.set('Origin',origin);return mf.dispatchFetch(url,{...init,headers});}});
 const secrets=await signInIdentity(provider(),password),first=await openProtocolClient({provider:provider(),secrets,indexedDB:new IDBFactory(),locks:{request:(_,fn)=>fn()},automaticDevice:true});
 await first.post('keep this encrypted post');await first.flush();await first.close();
 const next='replacement account password 987!';
 const result=await request('/password',{actor,method:'POST',data:{currentPassword:password,password:next}});assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal((await request('/login',{method:'POST',data:{username:'portablepassword',password}})).status,401);
 const login=await request('/login',{method:'POST',data:{username:'portablepassword',password:next}});assert.equal(login.status,200);
 actor={...login.data,cookie:login.headers.get('Set-Cookie').split(';')[0]};
 const restored=await unlock(provider(),next);assert.deepEqual(restored,secrets);
 const second=await openProtocolClient({provider:provider(),secrets:restored,indexedDB:new IDBFactory(),locks:{request:(_,fn)=>fn()},automaticDevice:true});
 try{await second.restoreArchive();assert.equal((await second.view()).posts[0].payload.body,'keep this encrypted post');}finally{await second.close();}
 const candidates=['concurrent password alpha 123!','concurrent password beta 456!'];
 const attempts=await Promise.all(candidates.map(password=>request('/password',{actor,method:'POST',data:{currentPassword:next,password}})));
 assert.equal(attempts.filter(r=>r.status===200).length,1);
 const winner=candidates[attempts.findIndex(r=>r.status===200)];
 const winningLogin=await request('/login',{method:'POST',data:{username:'portablepassword',password:winner}});assert.equal(winningLogin.status,200);
 actor={...winningLogin.data,cookie:winningLogin.headers.get('Set-Cookie').split(';')[0]};
 assert.deepEqual(await unlock(provider(),winner),secrets);

});
