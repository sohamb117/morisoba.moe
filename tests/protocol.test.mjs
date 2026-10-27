import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity,signRecord,verifyRecord,canonical,seal,open,randomKey} from '../protocol/records.mjs';
import {createVault,unlockVault,changeVaultPassword} from '../protocol/vault.mjs';
import {createRatchet} from '../protocol/ratchet.mjs';
import {inMemoryStore} from '@open-e2ee/signal-protocol-sdk/local/store/memory';
test('signed records bind identity, payload, version and canonical encoding',async()=>{
 const identity=await createIdentity(),record=await signRecord(identity,'object',{test:'hello'});
 assert.ok(await verifyRecord(record));for(const patch of [{author:'someone'},{id:'bad'},{payload:{test:'changed'}},{extra:true}])assert.equal(await verifyRecord({...record,...patch}),false);
 assert.throws(()=>canonical({n:NaN}));assert.throws(()=>canonical({n:0.1}));assert.throws(()=>canonical({n:-0}));assert.throws(()=>canonical({text:'\ud800'}));
 assert.equal(canonical({b:1,a:2}),'{"a":2,"b":1}');
});
test('body encryption authenticates context and fresh nonce',async()=>{const key=randomKey(),ctx={author:'alice'},a=await seal(key,{body:'private'},ctx),b=await seal(key,{body:'private'},ctx);assert.notEqual(a.nonce,b.nonce);assert.deepEqual(await open(key,a,ctx),{body:'private'});await assert.rejects(open(key,a,{author:'bob'}));});
test('password vault rejects wrong password, wrong identity and altered parameters; rewrap preserves archive',async()=>{
 const identity=await createIdentity(),password='correct test password',contents={identity,archiveKey:'test archive'};
 const vault=await createVault(identity.id,password,contents);assert.deepEqual(await unlockVault(vault,identity.id,password),contents);
 await assert.rejects(unlockVault(vault,identity.id,'incorrect password'));await assert.rejects(unlockVault(vault,'other',password));await assert.rejects(unlockVault({...vault,kdf:{...vault.kdf,m:8}},identity.id,password));
 const changed=await changeVaultPassword(vault,identity.id,password,'a different password');assert.deepEqual(changed.contents,vault.contents);assert.deepEqual(await unlockVault(changed,identity.id,'a different password'),contents);await assert.rejects(unlockVault(changed,identity.id,password));
});
test('real ratchet exchanges authenticated messages, rejects replay, and handles reordering',async()=>{
 const a=await createIdentity(),b=await createIdentity();let alice,bob;
 try{
 alice=await createRatchet({identity:a,storage:inMemoryStore()});bob=await createRatchet({identity:b,storage:inMemoryStore()});
 await bob.replenish(3);const bundles=await bob.bundles();await alice.connect(bundles[0],b.id);
 const first=await alice.encrypt(b.id,1,{text:'first'});assert.deepEqual(await bob.decrypt(a.id,1,first),{text:'first'});
 await assert.rejects(bob.decrypt(a.id,1,first));
 const ack=await bob.encrypt(a.id,1,{type:'ack'});assert.deepEqual(await alice.decrypt(b.id,1,ack),{type:'ack'});
 const second=await alice.encrypt(b.id,1,{text:'second'}),third=await alice.encrypt(b.id,1,{text:'third'});
 assert.deepEqual(await bob.decrypt(a.id,1,third),{text:'third'});assert.deepEqual(await bob.decrypt(a.id,1,second),{text:'second'});
 await assert.rejects(alice.connect(bundles[0],a.id));
 }finally{await alice?.stop();await bob?.stop();}
});
