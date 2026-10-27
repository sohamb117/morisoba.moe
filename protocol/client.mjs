import {createIdentity,signRecord,verifyRecord,randomKey,b64,unb64,canonical,hash,encode,seal,open} from './records.mjs';
import {createVault,unlockVault} from './vault.mjs';
import {createRatchet,SUITE} from './ratchet.mjs';
import {openLocalStore} from './local-store.mjs';
import {encryptEvent,decryptEvent,project,makeHistoryJob,replayHistory} from './social.mjs';
const BASE='/api/mimori/v1';
export class ProviderClient {
 constructor(origin,{csrf,fetch:transport=globalThis.fetch.bind(globalThis)}={}){this.origin=new URL(origin).origin;this.csrf=csrf;this.fetch=transport;}
 async request(path,{data,method=data===undefined?'GET':'POST',privateAccess=false}={}){
 const response=await this.fetch(this.origin+BASE+path,{method,credentials:privateAccess?'same-origin':'omit',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(privateAccess&&this.csrf?{'X-CSRF-Token':this.csrf}:{})},body:data===undefined?undefined:canonical(data)});
 const result=await response.json();if(!response.ok)throw Error(result.error??'Provider request failed');return result;
 }
 publish(record){return this.request('/records',{data:record,privateAccess:true});}
}
const empty=()=>({partners:{},events:[],archive:{},seen:{},outbox:[],jobs:{},cursors:{},historyGrants:{}});
export async function enroll(provider,password){
 // Save the encrypted recovery artifact locally BEFORE publishing this identity.
 const identity=await createIdentity(),secrets={identity,storeKey:b64(randomKey()),archiveKey:b64(randomKey()),epoch:crypto.randomUUID()};
 const vault=await createVault(identity.id,password,secrets);
 const record=await signRecord(identity,'identity',{revision:1,previous:null,providers:[provider.origin]});
 return {identity,secrets,vault,record,async commit(){await provider.request('/enroll',{data:record,privateAccess:true});await provider.request('/vault',{method:'PUT',data:{revision:0,vault},privateAccess:true});}};
}
export async function unlock(provider,password){const {vault}=await provider.request('/vault',{privateAccess:true});return unlockVault(vault,vault.owner,password);}
export async function openProtocolClient({provider,secrets,indexedDB,locks,createDevice=false}){
 const {identity}=secrets,local=await openLocalStore({name:identity.id+':'+secrets.epoch,key:unb64(secrets.storeKey,32),indexedDB,locks});
 if(!await local.storage.getMetadata('mimori:device-present')&&!createDevice){local.close();throw Object.assign(Error('Messaging session unavailable on this browser.'),{code:'DEVICE_STATE_MISSING'});}
 const ratchet=await createRatchet({identity,storage:local.storage}),archiveKey=unb64(secrets.archiveKey,32);
 await local.storage.setMetadata('mimori:device-present','1');
 const getState=async()=>JSON.parse(await local.storage.getMetadata('mimori:app')??JSON.stringify(empty()));
 const save=state=>local.storage.setMetadata('mimori:app',canonical(state));
 async function transaction(fn){return local.atomic(async()=>{const state=await getState(),result=await fn(state);await save(state);return result;});}
 async function wrap(partner,payload){const message=await ratchet.encrypt(partner,1,payload);return signRecord(identity,'envelope',{recipient:partner,device:'1',suite:SUITE,message:canonical(message)});}
 async function queueEvent(state,event){
 const entry=await encryptEvent(identity,event);state.events.push(entry.event);
 state.archive[entry.object.id]={object:entry.object,event:entry.event,archivedKey:await seal(archiveKey,{key:entry.key},{object:entry.object.id}),deleted:false};
 state.outbox.push(entry.object);
 for(const partner of event.audience.filter(id=>id!==identity.id)){
 if(!state.partners[partner]?.accepted){if(event.relay&&partner!==event.relay)continue;throw Error('Recipient is not an accepted partner');}
 state.outbox.push(await wrap(partner,{object:entry.object.id,key:entry.key,provider:provider.origin}));
 }
 return entry.event;
 }
 const api={
 identity,provider,
 async partners(){return (await getState()).partners;},
 async publishPrekeys(){await local.atomic(()=>ratchet.replenish());for(const r of await ratchet.bundles())await provider.publish(r);},
 async requestPartner(partner,origin){
 if(partner===identity.id)throw Error('Cannot add yourself');const remote=new ProviderClient(origin,{fetch:provider.fetch});
 const record=await remote.request('/identities/'+encodeURIComponent(partner));if(!await verifyRecord(record)||record.author!==partner)throw Error('Partner identity mismatch');
 const request=await signRecord(identity,'keyring.request',{recipient:partner});await provider.publish(request);
 await transaction(async state=>{state.partners[partner]={origin:remote.origin,accepted:false,request};});return request;
 },
 async acceptPartner(request,origin){
 if(request.kind!=='keyring.request'||request.payload.recipient!==identity.id||!await verifyRecord(request))throw Error('Invalid partner request');
 await provider.publish(request);const accept=await signRecord(identity,'keyring.accept',{request:request.id});await provider.publish(accept);
 await transaction(async state=>{state.partners[request.author]={origin:new URL(origin).origin,accepted:true,request,accept};});return accept;
 },
 async confirmPartner(accept){
 if(!await verifyRecord(accept)||accept.kind!=='keyring.accept')throw Error('Invalid acceptance');
 const state=await getState(),partner=state.partners[accept.author];if(!partner||accept.payload.request!==partner.request.id)throw Error('Unexpected acceptance');
 await provider.publish(accept);await transaction(async state=>{state.partners[accept.author].accepted=true;});
 },
 async connect(partner){
 const state=await getState(),p=state.partners[partner];if(!p?.accepted)throw Error('Mutual acceptance required');
 const remote=new ProviderClient(p.origin,{fetch:provider.fetch});
 const claim=await signRecord(identity,'prekey.claim',{identity:partner,device:1,nonce:await hash(randomKey()),expires:Date.now()+240000,provider:remote.origin});
 const bundle=await remote.request('/prekeys/claim-signed',{data:claim});await local.atomic(()=>ratchet.connect(bundle,partner));
 },
 async post(body,{mentions=[]}={}){return transaction(state=>queueEvent(state,{type:'post',eventId:crypto.randomUUID(),createdAt:Date.now(),audience:[identity.id,...Object.keys(state.partners).filter(id=>state.partners[id].accepted)],body,mentions}));},
 async importLegacy(selected){
 if(!Array.isArray(selected)||selected.length>100)throw Error('Select at most 100 posts per import');
 const exported=await provider.request('/legacy-export',{privateAccess:true}),ids=new Set(selected),posts=exported.posts.filter(p=>ids.has(p.id)&&!p.deleted_at);
 if(posts.length!==ids.size)throw Error('Selection contains missing or deleted posts');
 return transaction(async state=>{const results=[];for(const post of posts){
 if(state.events.some(r=>r.author===identity.id&&r.payload.legacy?.id===post.id&&r.payload.legacy?.provider===provider.origin))continue;
 results.push(await queueEvent(state,{type:'post',eventId:crypto.randomUUID(),createdAt:Date.now(),audience:[identity.id,...Object.keys(state.partners).filter(id=>state.partners[id].accepted)],body:post.body,legacy:{id:post.id,provider:provider.origin,createdAt:post.created_at,imported:true}}));}return results;});
 },
 async profile(displayName,bio){return transaction(state=>queueEvent(state,{type:'profile',eventId:crypto.randomUUID(),createdAt:Date.now(),audience:[identity.id,...Object.keys(state.partners).filter(id=>state.partners[id].accepted)],displayName,bio}));},
 async reply(target,body){return transaction(state=>{
 const parent=state.events.find(r=>r.id===target);if(!parent)throw Error('Unknown parent');
 const root=state.events.find(r=>r.id===(parent.payload.root??parent.id));if(!root)throw Error('Unknown root');
 const audience=parent.payload.audience.filter(id=>root.payload.audience.includes(id));
 return queueEvent(state,{type:'reply',eventId:crypto.randomUUID(),createdAt:Date.now(),audience,body,target,root:root.id,relay:root.author});
 });},
 async like(target,{remove=false}={}){return transaction(state=>{
 const post=state.events.find(r=>r.id===target);if(!post)throw Error('Unknown post');const audience=post.payload.audience,root=state.events.find(r=>r.id===(post.payload.root??post.id));if(!root)throw Error('Unknown root');
 return queueEvent(state,{type:remove?'like.remove':'like.add',eventId:crypto.randomUUID(),createdAt:Date.now(),audience,target,root:root.id,relay:root.author,...(remove?{removes:state.events.filter(r=>r.author===identity.id&&r.payload.type==='like.add'&&r.payload.target===target).map(r=>r.id)}:{})});
 });},
 async removePartner(partner){const state=await getState(),p=state.partners[partner];if(!p)throw Error('Unknown partner');await provider.publish(await signRecord(identity,'keyring.remove',{request:p.request.id}));await transaction(async state=>{state.partners[partner].accepted=false;});},
 async backupArchive(){
 const state=await getState();
 for(const [id,entry] of Object.entries(state.archive)){
 let revision=0;const context={identity:identity.id,object:id,purpose:'archive'};
 try{const remote=await provider.request('/archive/'+id,{privateAccess:true});revision=remote.revision;const old=await open(archiveKey,remote.archive,context);if(old.deleted)entry.deleted=true;if(canonical(old)===canonical(entry))continue;}catch(e){if(e.message!=='No archive')throw e;}
 const archive=await seal(archiveKey,entry,context);await provider.request('/archive/'+id,{method:'PUT',data:{revision,archive},privateAccess:true});
 }
 },
 async restoreArchive(){
 let cursor='',restored=0;
 while(true){const page=await provider.request('/archive?cursor='+cursor,{privateAccess:true});
 await transaction(async state=>{for(const item of page.entries){
 const id=item.id,entry=await open(archiveKey,item.archive,{identity:identity.id,object:id,purpose:'archive'});
 const {key}=await open(archiveKey,entry.archivedKey,{object:id});const event=await decryptEvent(entry.object,key,identity.id);
 if(entry.object.id!==id||event.author!==identity.id||event.id!==entry.event.id)throw Error('Invalid archive entry');
 if(!state.archive[id])state.archive[id]=entry;else if(entry.deleted)state.archive[id].deleted=true;
 if(!state.events.some(r=>r.id===event.id))state.events.push(event);restored++;
 }});
 if(page.entries.length<50)break;cursor=page.cursor;
 }return restored;
 },
 async deletePost(target){return transaction(async state=>{
 const event=state.events.find(r=>r.id===target);if(event?.author!==identity.id)throw Error('Only the author can delete a post');
 const tombstone=await queueEvent(state,{type:'delete',eventId:crypto.randomUUID(),createdAt:Date.now(),audience:event.payload.audience,target});
 for(const entry of Object.values(state.archive))if(entry.event.id===target)entry.deleted=true;return tombstone;
 });},
 async flush(){
 // Network retries send exactly the already-committed signed bytes.
 while(true){const state=await getState(),record=state.outbox[0];if(!record){await api.backupArchive();return;}await provider.publish(record);await transaction(async state=>{state.outbox=state.outbox.filter(r=>r.id!==record.id);});}
 },
 async receive(record,origin){
 if(record.kind!=='envelope'||record.payload.recipient!==identity.id||record.payload.suite!==SUITE||!await verifyRecord(record))throw Error('Invalid envelope');
 const remote=new ProviderClient(origin,{fetch:provider.fetch});
 return transaction(async state=>{
 if(state.seen[record.id])return null;
 if(!state.partners[record.author]?.accepted)throw Error('Sender is not an accepted partner');
 const payload=await ratchet.decrypt(record.author,1,JSON.parse(record.payload.message));
 const source=new ProviderClient(payload.provider??remote.origin,{fetch:provider.fetch});const object=await source.request('/objects/'+payload.object);if(object.id!==payload.object)throw Error('Object hash mismatch');
 const event=await decryptEvent(object,payload.key,identity.id,{historyGrant:payload.historyGrant});
 if(event.author!==record.author){
 const root=state.events.find(r=>r.id===event.payload.root);
 if(!['reply','like.add','like.remove'].includes(event.payload.type)||event.payload.relay!==record.author||root?.author!==record.author||!event.payload.audience.every(id=>root.payload.audience.includes(id)))throw Error('Unauthorized forwarding');
 }
 if(event.payload.relay===identity.id&&event.author!==identity.id&&!state.events.some(r=>r.id===event.id)){
 const root=state.events.find(r=>r.id===event.payload.root),target=state.events.find(r=>r.id===event.payload.target);
 if(root?.author!==identity.id||!target||!event.payload.audience.every(id=>root.payload.audience.includes(id)&&target.payload.audience.includes(id)))throw Error('Invalid relay audience');
 for(const partner of event.payload.audience){if(partner===identity.id||partner===event.author||!state.partners[partner]?.accepted)continue;
 state.outbox.push(await wrap(partner,{object:object.id,key:payload.key,provider:remote.origin}));}
 }

 if(payload.historyGrant)state.historyGrants[event.id]=payload.historyGrant;
 if(!state.events.some(r=>r.id===event.id))state.events.push(event);state.seen[record.id]=true;return event;
 });
 },
 async sync(){const state=await getState();for(const [partner,p] of Object.entries(state.partners)){if(!p.accepted)continue;const remote=new ProviderClient(p.origin,{fetch:provider.fetch});let cursor=state.cursors[p.origin]??0;
 const page=await remote.request('/records?recipient='+encodeURIComponent(identity.id)+'&cursor='+cursor);
 for(const record of page.records)if(record.kind==='envelope')await api.receive(record,p.origin);await transaction(async state=>{state.cursors[p.origin]=page.cursor;});
 }return api.view();},
 async view(){const state=await getState();return project(state.events,identity.id,{historyGrants:state.historyGrants});},
 async history(partner,{shareOlderPosts=false}={}){return transaction(async state=>{if(!state.partners[partner]?.accepted)throw Error('Partner is not accepted');const job=await makeHistoryJob(identity,partner,Object.values(state.archive),{shareOlderPosts});if(job)state.jobs[job.id]=job;return job;});},
 async replay(jobId){
 const current=await getState(),job=current.jobs[jobId];if(!job)throw Error('Unknown history job');
 // Each bounded replay step uses one outer local transaction, including ratchet state.
 return transaction(async state=>replayHistory({job:state.jobs[jobId],identity,
 archive:async id=>{const e=state.archive[id];return e?{...e,...await open(archiveKey,e.archivedKey,{object:id})}:null;},
 isPartner:async partner=>Boolean(state.partners[partner]?.accepted),atomic:fn=>fn(),wrap:async(partner,payload)=>wrap(partner,{...payload,provider:provider.origin}),enqueue:async r=>state.outbox.push(r),saveJob:async j=>{state.jobs[j.id]=j;}}));
 },
 async close(){await ratchet.stop();archiveKey.fill(0);local.close();}
 };
 return api;
}
