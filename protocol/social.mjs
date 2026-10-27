import {signRecord,verifyRecord,randomKey,seal,open,b64,unb64,VERSION} from './records.mjs';
const kinds=new Set(['post','reply','profile','like.add','like.remove','delete']);
const unique=xs=>Array.isArray(xs)&&xs.length<=200&&new Set(xs).size===xs.length&&xs.every(x=>/^mimori:1:[A-Za-z0-9_-]{43}$/.test(x));
export function validateEvent(event){
 if(!kinds.has(event.type)||!Number.isSafeInteger(event.createdAt)||event.createdAt<0||!unique(event.audience)||typeof event.eventId!=='string'||event.eventId.length>128)throw Error('Invalid social event');
 if(['post','reply'].includes(event.type)&&(typeof event.body!=='string'||!event.body.trim()||event.body.length>10000))throw Error('Invalid post');
 if(event.type==='profile'&&(typeof event.displayName!=='string'||event.displayName.length>80||typeof event.bio!=='string'||event.bio.length>500))throw Error('Invalid profile');
 if(['reply','like.add','like.remove','delete'].includes(event.type)&&(typeof event.target!=='string'||!event.target))throw Error('Missing target');
 if(event.type==='reply'&&(typeof event.root!=='string'||!event.root))throw Error('Missing thread root');
 if(event.type==='like.remove'&&(!Array.isArray(event.removes)||event.removes.length>1000||event.removes.some(v=>typeof v!=='string')))throw Error('Invalid removed likes');
 if(event.relay!==undefined&&(!event.audience.includes(event.relay)||typeof event.root!=='string'))throw Error('Invalid relay permission');
 if(event.mentions!==undefined&&(!unique(event.mentions)||event.mentions.some(id=>!event.audience.includes(id))))throw Error('Mentions cannot expand the audience');
}
export async function createEvent(identity,event){validateEvent(event);if(!event.audience.includes(identity.id))throw Error('Audience must include author');return signRecord(identity,'social',event);}
export async function encryptEvent(identity,event){
 const signed=await createEvent(identity,event),key=randomKey(),context={version:VERSION,purpose:'social-body',author:identity.id};
 const object=await signRecord(identity,'object',{box:await seal(key,signed,context)});
 return {object,key:b64(key),event:signed};
}
export async function decryptEvent(object,key,viewer,{historyGrant}={}){
 if(object.kind!=='object'||!await verifyRecord(object))throw Error('Invalid object');
 const signed=await open(unb64(key,32),object.payload.box,{version:VERSION,purpose:'social-body',author:object.author});
 if(signed.kind!=='social'||signed.author!==object.author||!await verifyRecord(signed))throw Error('Invalid event signature');validateEvent(signed.payload);
 if(!signed.payload.audience.includes(viewer)){
 if(!historyGrant||!await verifyRecord(historyGrant)||historyGrant.kind!=='history.grant'||historyGrant.author!==signed.author||historyGrant.payload.recipient!==viewer||historyGrant.payload.object!==object.id||!['post','profile'].includes(signed.payload.type))throw Error('Outside audience');
 }
 return signed;
}
// Pure projection: order-independent likes; tombstones never erase the stored signed record.
export async function project(records,viewer,{historyGrants={}}={}){
 const valid=[];for(const r of records){if(r.kind!=='social'||!await verifyRecord(r))continue;try{validateEvent(r.payload);}catch{continue;}const grant=historyGrants[r.id];if(r.payload.audience.includes(viewer)||(grant&&await verifyRecord(grant)&&grant.kind==='history.grant'&&grant.author===r.author&&grant.payload.recipient===viewer&&r.payload.type==='post'))valid.push(r);}
 const byId=new Map(valid.map(r=>[r.id,r])),removed=new Set(),deleted=new Set(),posts=[],profiles=new Map();
 for(const r of valid){const e=r.payload;
 if(e.type==='like.remove')for(const id of e.removes)removed.add(r.author+'\0'+id);
 if(e.type==='delete'&&byId.get(e.target)?.author===r.author)deleted.add(e.target);
 if(e.type==='profile'){const old=profiles.get(r.author);if(!old||e.createdAt>old.payload.createdAt||(e.createdAt===old.payload.createdAt&&r.id>old.id))profiles.set(r.author,r);}
 }
 const likes=new Map();
 for(const r of valid){const e=r.payload;
 if(e.type==='like.add'&&!removed.has(r.author+'\0'+r.id)&&byId.has(e.target)&&!deleted.has(e.target)){
 const target=byId.get(e.target);if(!target.payload.audience.includes(r.author)||!e.audience.every(id=>target.payload.audience.includes(id)))continue;
 if(!likes.has(e.target))likes.set(e.target,new Set());likes.get(e.target).add(r.author);
 }
 if(['post','reply'].includes(e.type)&&!deleted.has(r.id)){
 if(e.type==='reply'){const parent=byId.get(e.target),root=byId.get(e.root);if(!parent||!root||!e.audience.includes(root.author)||!e.audience.every(id=>parent.payload.audience.includes(id)&&root.payload.audience.includes(id)))continue;}
 posts.push(r);
 }
 }
 posts.sort((a,b)=>b.payload.createdAt-a.payload.createdAt||b.id.localeCompare(a.id));return {posts,profiles,likes,deleted};
}
export async function makeHistoryJob(identity,partner,entries,{shareOlderPosts=false,cutoff=Date.now()}={}){
 if(!shareOlderPosts)return null;
 const selected=entries.filter(e=>e.event.author===identity.id&&e.event.payload.type==='post'&&!e.deleted&&!e.superseded&&e.event.payload.createdAt<=cutoff);
 const manifest=await signRecord(identity,'history.manifest',{recipient:partner,cutoff,objects:selected.map(e=>e.object.id)});
 return {id:manifest.id,manifest,partner,cursor:0,status:'ready',total:selected.length};
}
// Store adapter commits the envelope, next ratchet state and cursor together.
// A delivery failure leaves the identical envelope in the outbox for retry.
export async function replayHistory({job,identity,archive,isPartner,atomic,wrap,enqueue,saveJob,batchSize=20}){
 if(job.status==='complete'||job.status==='paused')return job;
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw Error('Invalid batch size');
 let next=structuredClone(job);
 for(let count=0;count<batchSize&&next.cursor<next.total;count++){
 if(!await isPartner(next.partner)){next.status='paused';await saveJob(next);return next;}
 const id=next.manifest.payload.objects[next.cursor],entry=await archive(id);
 await atomic(async()=>{
 if(entry&&!entry.deleted&&!entry.superseded){
 if(entry.event.author!==identity.id||entry.event.payload.type!=='post'||entry.object.id!==id)throw Error('History ownership mismatch');
 const grant=await signRecord(identity,'history.grant',{recipient:next.partner,object:id,manifest:next.id});
 const envelope=await wrap(next.partner,{object:id,key:entry.key,historyGrant:grant});await enqueue(envelope);
 }
 next={...next,cursor:next.cursor+1,status:next.cursor+1===next.total?'complete':'running'};await saveJob(next);
 });
 }
 if(next.total===0){next.status='complete';await saveJob(next);}return next;
}
