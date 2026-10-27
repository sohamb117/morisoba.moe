import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createIdentity,signRecord,canonical,seal,randomKey,hash,encode} from '../protocol/records.mjs';
let providers=[],alice,bob;const base='/api/mimorigasaka-protocol/v1';
async function request(provider,path,{actor,method='GET',data,headers={}}={}){
 const origin=provider.origin;
 const r=await provider.mf.dispatchFetch(origin+base+path,{method,headers:{...(actor?{'X-Test-User':actor,'X-CSRF-Token':actor}:{}),...(method!=='GET'?{Origin:origin,'Content-Type':'application/json'}:{}),...headers},body:data===undefined?undefined:canonical(data)});
 return {status:r.status,data:await r.json()};
}
before(async()=>{
 const bundle=await build({stdin:{contents:"import {protocolMiddleware} from './protocol/provider.mjs';export default {fetch:(r,e)=>protocolMiddleware(r,e,()=>new Response('not found',{status:404}),{authenticate:async r=>{const id=r.headers.get('X-Test-User');return id?{id,csrf:id,username:id,display_name:id,bio:''}:null;}})}",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral'});
 for(const origin of ['https://provider-one.test','https://provider-two.test']){
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',d1Databases:['MIMORI_PROTOCOL_DB','MIMORI_DB'],bindings:{MIMORI_PROTOCOL_ENABLED:'true'}}));
 const db=await mf.getD1Database('MIMORI_PROTOCOL_DB'),legacy=await mf.getD1Database('MIMORI_DB');
 for(const statement of ((await readFile('protocol/migrations/0001_protocol.sql','utf8'))+(await readFile('protocol/migrations/0002_archives.sql','utf8'))+(await readFile('protocol/migrations/0003_devices.sql','utf8'))).split(';').filter(s=>s.trim()))await db.prepare(statement).run();
 await legacy.prepare('CREATE TABLE mimori_posts(id INTEGER,user_id TEXT,body TEXT,pinned INTEGER,created_at INTEGER,updated_at INTEGER,deleted_at INTEGER)').run();
 await legacy.prepare("INSERT INTO mimori_posts VALUES(1,'alice','legacy private post',0,1,1,NULL),(2,'bob','another private post',0,1,1,NULL)").run();
 providers.push({mf,db,legacy,origin});
 }
 alice=await createIdentity();bob=await createIdentity();
 for(const provider of providers)for(const [actor,id] of [['alice',alice],['bob',bob]])assert.equal((await request(provider,'/enroll',{actor,method:'POST',data:await signRecord(id,'identity',{revision:1,previous:null,providers:[provider.origin]})})).status,201);
});
after(async()=>{for(const p of providers)await p.mf.dispose();});
test('public ciphertext reads across two independent providers; writes require authenticated matching identity',async()=>{
 const record=await signRecord(alice,'object',{box:await seal(randomKey(),{private:'message'},{})});
 for(const p of providers){
 assert.equal((await request(p,'/records',{method:'POST',data:record})).status,401);
 assert.equal((await request(p,'/records',{actor:'bob',method:'POST',data:record})).status,400);
 assert.equal((await request(p,'/records',{actor:'alice',method:'POST',data:record,headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await request(p,'/records',{actor:'alice',method:'POST',data:record})).status,201);
 assert.equal((await request(p,'/records',{actor:'alice',method:'POST',data:record})).status,201);
 assert.deepEqual((await request(p,'/objects/'+record.id)).data,record);
 assert.equal((await p.db.prepare('SELECT count(*) AS n FROM protocol_records WHERE id=?').bind(record.id).first()).n,1);
 }
});
test('vault is account-private with compare-and-swap protection',async()=>{
 const p=providers[0],box=await seal(randomKey(),{},{}),vault={version:1,owner:alice.id,kdf:{name:'argon2id',m:65536,t:3,p:4,dkLen:32,salt:'AAAAAAAAAAAAAAAAAAAAAA'},wrapped:box,contents:box};
 assert.equal((await request(p,'/vault',{actor:'alice',method:'PUT',data:{revision:0,vault}})).status,200);
 assert.equal((await request(p,'/vault')).status,401);assert.equal((await request(p,'/vault',{actor:'bob'})).status,404);
 const writes=await Promise.all([1,2].map(()=>request(p,'/vault',{actor:'alice',method:'PUT',data:{revision:1,vault}})));assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
 assert.equal((await request(p,'/vault',{actor:'alice',method:'PUT',data:{revision:0,vault}})).status,409);
});
test('legacy export is own-account only and leaves every legacy row untouched',async()=>{
 for(const p of providers){const before=await p.legacy.prepare('SELECT * FROM mimori_posts ORDER BY id').all();const r=await request(p,'/legacy-export',{actor:'alice'});assert.equal(r.status,200);assert.equal(r.data.posts.length,1);assert.equal(r.data.posts[0].body,'legacy private post');assert.deepEqual((await p.legacy.prepare('SELECT * FROM mimori_posts ORDER BY id').all()).results,before.results);}
});
test('identity revisions reject forks and rollback',async()=>{
 const p=providers[0],current=(await request(p,'/identities/'+encodeURIComponent(alice.id))).data;
 const revisions=await Promise.all(['https://one.test','https://two.test'].map(url=>signRecord(alice,'identity',{revision:2,previous:current.id,providers:[url]})));
 const results=await Promise.all(revisions.map(data=>request(p,'/records',{actor:'alice',method:'POST',data})));assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 assert.equal((await request(p,'/records',{actor:'alice',method:'POST',data:current})).status,409);
});
test('one-time prekey claims require mutual acceptance and cannot be reused',async()=>{
 const p=providers[0],req=await signRecord(alice,'keyring.request',{recipient:bob.id});
 await request(p,'/records',{actor:'alice',method:'POST',data:req});
 const claim={identity:bob.id,device:1,claim:await hash(encode('claim-1'))};
 assert.equal((await request(p,'/prekeys/claim',{actor:'alice',method:'POST',data:claim})).status,403);
 const accept=await signRecord(bob,'keyring.accept',{request:req.id});assert.equal((await request(p,'/records',{actor:'bob',method:'POST',data:accept})).status,201);
 const {createRatchet}=await import('../protocol/ratchet.mjs'),{inMemoryStore}=await import('@open-e2ee/signal-protocol-sdk/local/store/memory');const local=await createRatchet({identity:bob,storage:inMemoryStore()});await local.replenish(1);const [prekey]=await local.bundles();await local.stop();
 assert.equal((await request(p,'/records',{actor:'bob',method:'POST',data:prekey})).status,201);
 const claims=await Promise.all(['claim-1','claim-2'].map(async s=>request(p,'/prekeys/claim',{actor:'alice',method:'POST',data:{...claim,claim:await hash(encode(s))}})));assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);
 const winning=claims[0].status===200?'claim-1':'claim-2';assert.equal((await request(p,'/prekeys/claim',{actor:'alice',method:'POST',data:{...claim,claim:await hash(encode(winning))}})).status,200);
 await request(p,'/records',{actor:'bob',method:'POST',data:await signRecord(bob,'keyring.remove',{request:req.id})});
 assert.equal((await request(p,'/prekeys/claim',{actor:'alice',method:'POST',data:claim})).status,403);
});
test('end-to-end clients on separate providers exchange posts, replies, likes and explicit history replay',async()=>{
 const {ProviderClient,openProtocolClient}=await import('../protocol/client.mjs');const {indexedDB}=await import('fake-indexeddb');const {b64}=await import('../protocol/records.mjs');
 const tails=new Map(),locks={request(name,fn){const next=(tails.get(name)??Promise.resolve()).catch(()=>{}).then(fn);tails.set(name,next);return next;}};
 const c=await createIdentity(),d=await createIdentity();
 for(const [provider,actor,identity] of [[providers[0],'cara',c],[providers[1],'dan',d]])assert.equal((await request(provider,'/enroll',{actor,method:'POST',data:await signRecord(identity,'identity',{revision:1,previous:null,providers:[provider.origin]})})).status,201);
 const transport=(home,actor)=>async(url,init={})=>{const p=providers.find(p=>url.startsWith(p.origin)),headers=new Headers(init.headers);if(init.credentials==='same-origin'&&p===home)headers.set('X-Test-User',actor);if(init.method&&init.method!=='GET')headers.set('Origin',home.origin);return p.mf.dispatchFetch(url,{...init,headers});};
 const pc=new ProviderClient(providers[0].origin,{csrf:'cara',fetch:transport(providers[0],'cara')}),pd=new ProviderClient(providers[1].origin,{csrf:'dan',fetch:transport(providers[1],'dan')});
 const secrets=identity=>({identity,storeKey:b64(randomKey()),archiveKey:b64(randomKey()),epoch:crypto.randomUUID()});let cara,dan;
 try{
 const saved=secrets(c);
 await assert.rejects(openProtocolClient({provider:pc,secrets:saved,indexedDB,locks}),{code:'DEVICE_STATE_MISSING'});
 cara=await openProtocolClient({provider:pc,secrets:saved,indexedDB,locks,createDevice:true});dan=await openProtocolClient({provider:pd,secrets:secrets(d),indexedDB,locks,createDevice:true});
 await cara.post('before we became partners');await cara.flush();
 await cara.close();cara=await openProtocolClient({provider:pc,secrets:saved,indexedDB,locks});
 assert.equal((await cara.view()).posts[0].payload.body,'before we became partners');
 await cara.publishPrekeys();await dan.publishPrekeys();
 const req=await cara.requestPartner(d.id,pd.origin),accept=await dan.acceptPartner(req,pc.origin);await cara.confirmPartner(accept);await cara.connect(d.id);
 const post=await cara.post('hello across providers');await cara.flush();let view=await dan.sync();assert.equal(view.posts.length,1);assert.equal(view.posts[0].payload.body,'hello across providers');
 await dan.reply(post.id,'reply across providers');await dan.like(post.id);await dan.flush();view=await cara.sync();assert.equal(view.posts.length,3);assert.equal(view.likes.get(post.id).size,1);
 await dan.like(post.id,{remove:true});await dan.flush();view=await cara.sync();assert.equal(view.likes.size,0);
 assert.ok(await cara.restoreArchive()>0);assert.equal((await pd.request('/archive',{privateAccess:true})).entries.length,4);
 assert.equal(await cara.history(d.id),null);const job=await cara.history(d.id,{shareOlderPosts:true});await cara.replay(job.id);await cara.flush();view=await dan.sync();assert.ok(view.posts.some(r=>r.payload.body==='before we became partners'));
 const publicData=(await providers[0].db.prepare("SELECT record FROM protocol_records WHERE kind IN ('object','envelope')").all()).results;assert.ok(!JSON.stringify(publicData).includes('hello across providers'));
 }finally{await cara?.close();await dan?.close();}
});
test('root coordinator forwards signed replies between two friends who are not partners',async()=>{
 const {ProviderClient,openProtocolClient}=await import('../protocol/client.mjs'),{indexedDB}=await import('fake-indexeddb'),{b64}=await import('../protocol/records.mjs');
 const tails=new Map(),locks={request(name,fn){const p=(tails.get(name)??Promise.resolve()).catch(()=>{}).then(fn);tails.set(name,p);return p;}};
 const people=[];
 try{
 for(const [i,actor] of ['rootfriend','friendone','friendtwo'].entries()){
 const p=providers[i===0?0:1],identity=await createIdentity();await request(p,'/enroll',{actor,method:'POST',data:await signRecord(identity,'identity',{revision:1,previous:null,providers:[p.origin]})});
 const provider=new ProviderClient(p.origin,{csrf:actor,fetch:async(url,init={})=>{const dst=providers.find(p=>url.startsWith(p.origin)),headers=new Headers(init.headers);if(init.credentials==='same-origin'&&dst===p)headers.set('X-Test-User',actor);if(init.method!=='GET')headers.set('Origin',p.origin);return dst.mf.dispatchFetch(url,{...init,headers});}});
 const client=await openProtocolClient({provider,secrets:{identity,storeKey:b64(randomKey()),archiveKey:b64(randomKey()),epoch:crypto.randomUUID()},indexedDB,locks,createDevice:true});people.push(client);await client.publishPrekeys();
 }
 const [root,one,two]=people;
 for(const friend of [one,two]){const req=await root.requestPartner(friend.identity.id,friend.provider.origin),accept=await friend.acceptPartner(req,root.provider.origin);await root.confirmPartner(accept);await root.connect(friend.identity.id);}
 const post=await root.post('a shared thread');await root.flush();await one.sync();await two.sync();
 await one.reply(post.id,'reply through the coordinator');await one.like(post.id);await one.flush();await root.sync();await root.flush();const view=await two.sync();assert.ok(view.posts.some(r=>r.author===one.identity.id&&r.payload.body==='reply through the coordinator'));assert.equal(view.likes.get(post.id).size,1);
 }finally{for(const client of people)await client.close();}
});
test('fresh browsers keep identity, restore posts, and receive on independent device sessions',async()=>{
 const {ProviderClient,signInIdentity,openProtocolClient}=await import('../protocol/client.mjs');
 const {IDBFactory}=await import('fake-indexeddb');
 const password='one account password 123!',clients=[];
 const makeProvider=(home,actor)=>new ProviderClient(home.origin,{csrf:actor,fetch:async(url,init={})=>{
 const dst=providers.find(p=>url.startsWith(p.origin)),headers=new Headers(init.headers);
 if(init.credentials==='same-origin'&&dst===home)headers.set('X-Test-User',actor);
 if(init.method!=='GET')headers.set('Origin',home.origin);
 return dst.mf.dispatchFetch(url,{...init,headers});
 }});
 const p=makeProvider(providers[0],'portable'),q=makeProvider(providers[1],'portablefriend');
 const open=async(provider)=>{const client=await openProtocolClient({provider,secrets:await signInIdentity(provider,password),indexedDB:new IDBFactory(),locks:{request:(_,fn)=>fn()},automaticDevice:true});clients.push(client);await client.publishPrekeys();await client.restoreArchive();await client.refreshPartners();return client;};
 try{
 const first=await open(p);await first.post('post before second browser');await first.flush();
 const second=await open(p);assert.equal(second.identity.id,first.identity.id);assert.notEqual(second.deviceId,first.deviceId);
 assert.equal((await second.view()).posts[0].payload.body,'post before second browser');
 await second.post('post from second browser');await second.flush();await first.restoreArchive();assert.equal((await first.view()).posts.length,2);
 const friend=await open(q),req=await first.requestPartner(friend.identity.id,q.origin),accept=await friend.acceptPartner(req,p.origin);await first.confirmPartner(accept);
 await first.refreshPartners();await friend.refreshPartners();await second.refreshPartners();
 await friend.post('delivered to both browsers');await friend.flush();
 await first.sync();await second.sync();
 for(const client of [first,second])assert.ok((await client.view()).posts.some(r=>r.payload.body==='delivered to both browsers'));
 const third=await open(p);assert.equal((await third.view()).posts.length,3);
 assert.equal((await third.partners())[friend.identity.id].origin,q.origin);
 assert.equal((await p.request('/devices/'+encodeURIComponent(first.identity.id))).devices.length,3);
 }finally{for(const client of clients)await client.close();}
});
test('upgrading a legacy browser after a second device preserves its original ratchet and post',async()=>{
 const {ProviderClient,enroll,openProtocolClient}=await import('../protocol/client.mjs'),{IDBFactory}=await import('fake-indexeddb');
 const home=providers[0],actor='legacydevice';
 const provider=new ProviderClient(home.origin,{csrf:actor,fetch:async(url,init={})=>{const headers=new Headers(init.headers);if(init.credentials==='same-origin')headers.set('X-Test-User',actor);if(init.method!=='GET')headers.set('Origin',home.origin);return home.mf.dispatchFetch(url,{...init,headers});}});
 const pending=await enroll(provider,'one account password 123!');await pending.commit();
 const indexedDB=new IDBFactory(),locks={request:(_,fn)=>fn()};let first,second;
 try{
 first=await openProtocolClient({provider,secrets:pending.secrets,indexedDB,locks,createDevice:true});await first.publishPrekeys();await first.post('legacy browser content');await first.flush();await first.close();first=null;
 const prekeys=await home.db.prepare('SELECT bundle FROM protocol_prekeys WHERE identity=? ORDER BY id').bind(pending.identity.id).all();
 second=await openProtocolClient({provider,secrets:pending.secrets,indexedDB:new IDBFactory(),locks,automaticDevice:true});assert.equal(second.deviceId,2);await second.restoreArchive();assert.equal((await second.view()).posts.length,1);
 first=await openProtocolClient({provider,secrets:pending.secrets,indexedDB,locks,automaticDevice:true});assert.equal(first.deviceId,1);assert.equal((await first.view()).posts.length,1);
 assert.deepEqual((await home.db.prepare("SELECT bundle FROM protocol_prekeys WHERE identity=? AND device='1' ORDER BY id").bind(pending.identity.id).all()).results,prekeys.results);
 }finally{await first?.close();await second?.close();}
});
