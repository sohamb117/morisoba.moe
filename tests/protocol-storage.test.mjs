import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {assertBackendConformance} from '@open-e2ee/signal-protocol-sdk/local/store/key-value';
import {openLocalStore} from '../protocol/local-store.mjs';
import {randomKey,createIdentity} from '../protocol/records.mjs';
import {createRatchet} from '../protocol/ratchet.mjs';
const tails=new Map(),locks={request(name,fn){const prior=tails.get(name)??Promise.resolve(),next=prior.catch(()=>{}).then(fn);tails.set(name,next);return next;}};
test('persistent backend meets SDK atomic-write contract',async()=>{
 const opened=new Map();
 try{await assertBackendConformance({createBackend:async()=>{const name=crypto.randomUUID(),key=randomKey(),store=await openLocalStore({name,key,indexedDB,locks});opened.set(store.backend,{store,name,key});return store.backend;},reopen:async previous=>{const old=opened.get(previous);old.store.close();const store=await openLocalStore({...old,indexedDB,locks});opened.delete(previous);opened.set(store.backend,{...old,store});return store.backend;}});}finally{for(const {store} of opened.values())store.close();}
});
test('ratchet state and exact outbox ciphertext commit together, survive reopen, and rollback on error',async()=>{
 const identity=await createIdentity(),other=await createIdentity(),key=randomKey(),name=crypto.randomUUID();let local,peer,ratchet,bob;
 try{
 local=await openLocalStore({name,key,indexedDB,locks});peer=await openLocalStore({name:crypto.randomUUID(),key:randomKey(),indexedDB,locks});
 ratchet=await createRatchet({identity,storage:local.storage});bob=await createRatchet({identity:other,storage:peer.storage});await bob.replenish(2);const [bundle]=await bob.bundles();await local.atomic(()=>ratchet.connect(bundle,other.id));
 const before=await local.backend.getAllKeys();
 await assert.rejects(local.atomic(async()=>{await ratchet.encrypt(other.id,1,{body:'rollback'});await local.storage.setMetadata('outbox','bad');throw Error('Simulated quota failure');}));
 assert.equal(await local.storage.getMetadata('outbox'),null);assert.deepEqual(await local.backend.getAllKeys(),before);
 let ciphertext;await local.atomic(async()=>{ciphertext=await ratchet.encrypt(other.id,1,{body:'durable'});await local.storage.setMetadata('outbox',JSON.stringify(ciphertext));});
 assert.deepEqual(await bob.decrypt(identity.id,1,ciphertext),{body:'durable'});
 await ratchet.stop();ratchet=null;local.close();local=await openLocalStore({name,key,indexedDB,locks});
 assert.deepEqual(JSON.parse(await local.storage.getMetadata('outbox')),ciphertext);
 }finally{await ratchet?.stop();await bob?.stop();local?.close();peer?.close();}
});
