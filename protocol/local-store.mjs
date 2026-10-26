import {createTransactionalKeyValueBackend,keyValueStore} from '@open-e2ee/signal-protocol-sdk/local/store/key-value';
// One snapshot per transaction makes the SDK's synchronous batch semantics fit
// IndexedDB without awaiting cryptography inside an IndexedDB transaction.
export async function openLocalStore({name,key,indexedDB=globalThis.indexedDB,locks=globalThis.navigator?.locks}){
 if(!indexedDB||!locks)throw Error('IndexedDB and Web Locks are required');
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('mimori-protocol:'+name,1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 let staging=null,closed=false;
 const handle=map=>({get:k=>map.get(k)??null,set:(k,v)=>map.set(k,v),delete:k=>map.delete(k),keysWithPrefix:p=>[...map.keys()].filter(k=>k.startsWith(p))});
 const snapshot=()=>new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly'),r=tx.objectStore('state').get('snapshot');r.onsuccess=()=>resolve(r.result??{revision:0,entries:[]});r.onerror=()=>reject(r.error);});
 const commit=(old,map)=>new Promise((resolve,reject)=>{
 const tx=db.transaction('state','readwrite',{durability:'strict'}),s=tx.objectStore('state'),r=s.get('snapshot');let error;
 r.onsuccess=()=>{if((r.result?.revision??0)!==old.revision){error=Error('Concurrent state change');tx.abort();return;}s.put({revision:old.revision+1,entries:[...map]},'snapshot');};
 tx.oncomplete=()=>resolve();tx.onabort=()=>reject(error??tx.error??Error('Local transaction aborted'));tx.onerror=()=>{};
 });
 async function atomic(fn){
 if(closed)throw Error('Store is closed');
 return locks.request('mimori-protocol:'+name,async()=>{
 const old=await snapshot();staging=new Map(old.entries);
 try{const result=await fn();await commit(old,staging);return result;}finally{staging=null;}
 });
 }
 const engine={
 async read(fn){return fn(handle(staging??new Map((await snapshot()).entries)));},
 async transaction(fn){if(staging){fn(handle(staging));return;}await atomic(()=>fn(handle(staging)));}
 };
 const backend=createTransactionalKeyValueBackend(engine);
 // The key exists only in unlocked memory; its password-wrapped copy is in the vault.
 const secret=new Uint8Array(key);if(secret.length!==32)throw Error('Expected a 32-byte store key');
 const vault={custody:'app-vault',getSecret:async()=>new Uint8Array(secret),setSecret:async()=>{throw Error('Store key must be provisioned in the identity vault');},deleteSecret:async()=>{throw Error('Explicit device retirement required');}};
 const storage=await keyValueStore({storage:backend,vault});
 return {storage,backend,atomic,close(){closed=true;secret.fill(0);db.close();}};
}
