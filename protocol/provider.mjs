import {verifyRecord,canonical,unb64,VERSION} from './records.mjs';
const BASE='/api/mimori/v1',LEGACY_BASE='/api/mimorigasaka-protocol/v1';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Access-Control-Allow-Origin':'*'};
const reply=(value,status=200)=>Response.json(value,{status,headers});
class Fault extends Error{constructor(status,message){super(message);this.status=status;}}
const requireThat=(condition,status,message)=>{if(!condition)throw new Fault(status,message);};
const validId=x=>typeof x==='string'&&/^mimori:1:[A-Za-z0-9_-]{43}$/.test(x);
const validHash=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
const one=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
async function read(request){
 requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json',415,'Use JSON');
 let n=0;const chunks=[];const reader=request.body?.getReader();requireThat(reader,400,'Missing body');
 try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>65536){await reader.cancel();throw new Fault(413,'Record exceeds 64 KiB');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(n);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);requireThat(canonical(value)===text,400,'Send canonical JSON');return value;}catch(e){if(e instanceof Fault)throw e;throw new Fault(400,'Invalid JSON');}
}
function exact(value,keys){requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.sort().join(','),400,'Unexpected fields');}
function box(value){exact(value,['nonce','ciphertext']);try{unb64(value.nonce,12);requireThat(unb64(value.ciphertext).length>=16,400,'Invalid ciphertext');}catch{throw new Fault(400,'Invalid encrypted box');}}
function validateVault(vault,owner){
 exact(vault,['version','owner','kdf','wrapped','contents']);requireThat(vault.version===1&&vault.owner===owner,400,'Wrong vault owner');
 exact(vault.kdf,['name','m','t','p','dkLen','salt']);const k=vault.kdf;requireThat(k.name==='argon2id'&&k.m===65536&&k.t===3&&k.p===4&&k.dkLen===32,400,'Unsupported KDF');try{unb64(k.salt,16);}catch{throw new Fault(400,'Invalid salt');}box(vault.wrapped);box(vault.contents);
}
function sdkBase64(value,length){try{requireThat(typeof value==='string'&&btoa(atob(value))===value&&atob(value).length===length,400,'Invalid public key encoding');}catch{throw new Fault(400,'Invalid public key encoding');}}
function prekey(value,length,signed){exact(value,signed?['keyId','publicKey','signature']:['keyId','publicKey']);requireThat(Number.isSafeInteger(value.keyId)&&value.keyId>=0,400,'Invalid prekey ID');sdkBase64(value.publicKey,length);if(signed)sdkBase64(value.signature,64);}
function validate(record,allowLocal=false){
 const p=record.payload;
 switch(record.kind){
 case 'keyring.request':exact(p,['recipient']);requireThat(validId(p.recipient)&&p.recipient!==record.author,400,'Invalid partner');break;
 case 'keyring.accept':case 'keyring.remove':exact(p,['request']);requireThat(validHash(p.request),400,'Invalid request');break;
 case 'device.prekey':exact(p,p.addressing===undefined?['suite','device','bundle']:['suite','device','addressing','bundle']);requireThat(p.suite==='mimori-open-e2ee-13.2.0-experimental'&&Number.isSafeInteger(p.device)&&p.device>=1&&p.device<=2147483647&&p.bundle?.deviceId===1&&(p.device===1?p.addressing===undefined:p.addressing==='per-device-v1')&&p.bundle.ecOneTimePreKey&&p.bundle.kemOneTimePreKey,400,'Invalid prekey');
 exact(p.bundle,['registrationId','deviceId','identity','ecSignedPreKey','ecOneTimePreKey','kemOneTimePreKey']);requireThat(Number.isInteger(p.bundle.registrationId)&&p.bundle.registrationId>=0&&p.bundle.registrationId<=65535,400,'Invalid registration');
 exact(p.bundle.identity,['version','x25519PublicKey','ed25519PublicKey']);requireThat(p.bundle.identity.version===1,400,'Invalid device identity');sdkBase64(p.bundle.identity.x25519PublicKey,32);sdkBase64(p.bundle.identity.ed25519PublicKey,32);prekey(p.bundle.ecSignedPreKey,32,true);prekey(p.bundle.ecOneTimePreKey,32,false);prekey(p.bundle.kemOneTimePreKey,1569,true);break;
 case 'identity':exact(p,['revision','previous','providers']);requireThat(Number.isSafeInteger(p.revision)&&p.revision>=1&&(p.previous===null||validHash(p.previous))&&Array.isArray(p.providers)&&p.providers.length>0&&p.providers.length<=8&&p.providers.every(v=>{try{const u=new URL(v);return u.protocol==='https:'||(allowLocal&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname));}catch{return false;}}),400,'Invalid identity');break;
 case 'profile.public':exact(p,['revision','displayName','bio','published']);requireThat(p.published===true&&Number.isSafeInteger(p.revision)&&p.revision>0&&typeof p.displayName==='string'&&p.displayName.length<=80&&typeof p.bio==='string'&&p.bio.length<=500,400,'Invalid public profile');break;
 case 'object':exact(p,['box']);box(p.box);break;
 case 'envelope':exact(p,p.senderDevice===undefined?['recipient','device','suite','message']:['recipient','device','senderDevice','suite','message']);requireThat(p.senderDevice===undefined||(Number.isSafeInteger(p.senderDevice)&&p.senderDevice>=1&&p.senderDevice<=2147483647),400,'Invalid sender device');requireThat(validId(p.recipient)&&typeof p.device==='string'&&p.device.length>0&&p.device.length<=128&&p.suite==='mimori-open-e2ee-13.2.0-experimental'&&typeof p.message==='string'&&p.message.length>0,400,'Unsupported envelope');break;
 default:throw new Fault(400,'Unsupported record kind');
 }
}
export async function protocolMiddleware(request,env,next,{authenticate}={}){
 const url=new URL(request.url),discovery=['/.well-known/mimori','/.well-known/mimorigasaka'].includes(url.pathname);
 const matchedBase=url.pathname.startsWith(LEGACY_BASE+'/')?LEGACY_BASE:BASE;
 if(!discovery&&!url.pathname.startsWith(matchedBase+'/'))return next();
 if(env.MIMORI_PROTOCOL_ENABLED!=='true'||!env.MIMORI_PROTOCOL_DB)return reply({error:'Protocol is not enabled'},404);
 const db=env.MIMORI_PROTOCOL_DB,route=url.pathname.slice(matchedBase.length),method=request.method;
 try{
 if(method==='OPTIONS'&&(route==='/prekeys/claim'||route==='/records'||route.startsWith('/objects/')||route.startsWith('/identities/')))return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
 if(discovery){requireThat(method==='GET',405,'GET only');return reply({protocol:VERSION,experimental:true,api:url.origin+BASE,registration:'existing-provider-account',suites:['mimori-open-e2ee-13.2.0-experimental']});}
 if(method==='GET'&&route==='/records'){
 const cursor=Number(url.searchParams.get('cursor')??0),recipient=url.searchParams.get('recipient');
 requireThat(Number.isSafeInteger(cursor)&&cursor>=0&&(!recipient||validId(recipient)),400,'Invalid cursor or recipient');
 const results=(await db.prepare('SELECT sequence,record FROM protocol_records WHERE sequence>? AND (? IS NULL OR recipient=?) ORDER BY sequence LIMIT 100').bind(cursor,recipient,recipient).all()).results;
 return reply({records:results.map(r=>JSON.parse(r.record)),cursor:results.at(-1)?.sequence??cursor});
 }
 if(method==='GET'&&route.startsWith('/objects/')){const id=route.slice(9);requireThat(validHash(id),400,'Invalid ID');const row=await one(db,'SELECT record FROM protocol_records WHERE id=?',id);requireThat(row,404,'Not found');return reply(JSON.parse(row.record));}
 if(method==='GET'&&route.startsWith('/profiles/')){const id=decodeURIComponent(route.slice(10));requireThat(validId(id),400,'Invalid identity');const row=await one(db,"SELECT record FROM protocol_records WHERE author=? AND kind='profile.public' ORDER BY json_extract(record,'$.payload.revision') DESC,id DESC LIMIT 1",id);requireThat(row,404,'Not found');return reply(JSON.parse(row.record));}
 if(method==='GET'&&route.startsWith('/identities/')){const id=decodeURIComponent(route.slice(12));requireThat(validId(id),400,'Invalid identity');const row=await one(db,"SELECT record FROM protocol_records WHERE author=? AND kind='identity' ORDER BY sequence DESC LIMIT 1",id);requireThat(row,404,'Not found');return reply(JSON.parse(row.record));}
 if(method==='GET'&&route.startsWith('/devices/')){
 const id=decodeURIComponent(route.slice(9));requireThat(validId(id),400,'Invalid identity');
 const rows=(await db.prepare('SELECT DISTINCT CAST(device AS INTEGER) AS device FROM protocol_prekeys WHERE identity=? ORDER BY device').bind(id).all()).results;
 return reply({devices:rows.map(r=>r.device)});
 }
 // Cross-provider claims authenticate the signed request, not a foreign cookie.
 if(route==='/prekeys/claim-signed'&&method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
 if(route==='/prekeys/claim-signed'&&method==='POST'){
 const signed=await read(request);requireThat(signed.kind==='prekey.claim'&&await verifyRecord(signed),400,'Invalid claim signature');const p=signed.payload;
 exact(p,['identity','device','nonce','expires','provider']);requireThat(validId(p.identity)&&Number.isInteger(p.device)&&p.device>=1&&p.device<=2147483647&&validHash(p.nonce)&&p.provider===url.origin&&Number.isSafeInteger(p.expires)&&p.expires>Date.now()&&p.expires<=Date.now()+300000,400,'Invalid or expired claim');
 const link=await one(db,'SELECT request_id FROM protocol_links WHERE accepted=1 AND revoked=0 AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?))',signed.author,p.identity,p.identity,signed.author);requireThat(link,403,'Mutual keyring acceptance required');
 const previous=await one(db,'SELECT bundle FROM protocol_prekeys WHERE claim_id=? AND claimed_by=?',signed.id,signed.author);
 if(previous)return reply(JSON.parse(previous.bundle));
 const claimed=await one(db,'UPDATE protocol_prekeys SET claimed_by=?,claim_id=? WHERE id=(SELECT id FROM protocol_prekeys WHERE identity=? AND device=? AND claim_id IS NULL ORDER BY id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM protocol_prekeys WHERE claim_id=?) RETURNING bundle',signed.author,signed.id,p.identity,String(p.device),signed.id)??await one(db,'SELECT bundle FROM protocol_prekeys WHERE claim_id=? AND claimed_by=?',signed.id,signed.author);requireThat(claimed,409,'No one-time prekeys available; wait for partner');return reply(JSON.parse(claimed.bundle));
 }
 const user=await authenticate?.(request,env);requireThat(user,401,'Sign in to your provider');
 if(method!=='GET'){
 requireThat(request.headers.get('Origin')===url.origin,403,'Origin mismatch');requireThat(request.headers.get('X-CSRF-Token')===user.csrf,403,'Session check failed');
 }
 if(route==='/legacy-export'&&method==='GET'){
 const posts=(await env.MIMORI_DB.prepare('SELECT id,body,pinned,created_at,updated_at,deleted_at FROM mimori_posts WHERE user_id=? ORDER BY id').bind(user.id).all()).results;
 return reply({format:'mimori-legacy-export/1',profile:{username:user.username,displayName:user.display_name,bio:user.bio},posts,exportedAt:Date.now()});
 }
 if(route==='/enroll'&&method==='POST'){
 const input=await read(request),data=input.record??input;
 if(input.record){exact(input,['record','vault']);validateVault(input.vault,data.author);}
 requireThat(data.kind==='identity'&&await verifyRecord(data),400,'Invalid identity signature');validate(data,env.MIMORI_LOCAL==='true');
 requireThat(data.payload.revision===1&&data.payload.previous===null,400,'Initial identity required');
 const existing=await one(db,'SELECT identity FROM protocol_accounts WHERE legacy_user=?',user.id);
 requireThat(!existing||existing.identity===data.author,409,'Account already enrolled');
 await db.batch([
 db.prepare('INSERT INTO protocol_accounts(identity,legacy_user,public_key,created_at) VALUES(?,?,?,?) ON CONFLICT(identity) DO NOTHING').bind(data.author,user.id,data.publicKey,Date.now()),
 db.prepare("INSERT INTO protocol_records(id,author,kind,record,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM protocol_accounts WHERE identity=? AND legacy_user=?) ON CONFLICT(id) DO NOTHING").bind(data.id,data.author,data.kind,canonical(data),Date.now(),data.author,user.id),
 ...(input.record?[db.prepare('INSERT INTO protocol_vaults(identity,revision,encrypted) SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM protocol_accounts WHERE identity=? AND legacy_user=?) ON CONFLICT(identity) DO NOTHING').bind(data.author,canonical(input.vault),data.author,user.id)]:[])]);
 const owner=await one(db,'SELECT legacy_user FROM protocol_accounts WHERE identity=?',data.author);requireThat(owner?.legacy_user===user.id,409,'Identity already enrolled');return reply({identity:data.author},201);
 }
 const account=await one(db,'SELECT identity FROM protocol_accounts WHERE legacy_user=?',user.id);requireThat(account,403,'Enroll first');
 if(method!=='GET'){
 const window=Math.floor(Date.now()/60000);const rate=await one(db,'INSERT INTO protocol_limits(identity,window,count) VALUES(?,?,1) ON CONFLICT(identity) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count',account.identity,window);requireThat(rate.count<=120,429,'Write limit exceeded');
 }
 if(route==='/devices/register'&&method==='POST'){
 const data=await read(request);exact(data,['token','existing']);requireThat(validHash(data.token)&&(data.existing===null||data.existing===1),400,'Invalid device registration');
 const old=await one(db,'SELECT device FROM protocol_devices WHERE identity=? AND token=?',account.identity,data.token);if(old)return reply(old);
 // Allocate in one SQL statement; legacy device 1 is never replaced.
 const row=await one(db,`INSERT INTO protocol_devices(identity,token,device) SELECT ?,?,COALESCE(?,(SELECT MAX(device)+1 FROM (SELECT 0 AS device UNION ALL SELECT device FROM protocol_devices WHERE identity=? UNION ALL SELECT CAST(device AS INTEGER) FROM protocol_prekeys WHERE identity=?))) ON CONFLICT DO NOTHING RETURNING device`,account.identity,data.token,data.existing,account.identity,account.identity);
 requireThat(row,409,'Device registration conflict; retry');return reply(row,201);
 }
 if(route==='/partners'&&method==='GET'){
 const rows=(await db.prepare(`SELECT l.*,o.origin,r.record AS request,a.record AS accept FROM protocol_links l LEFT JOIN protocol_partner_origins o ON o.identity=? AND o.partner=CASE WHEN l.sender=? THEN l.recipient ELSE l.sender END JOIN protocol_records r ON r.id=l.request_id LEFT JOIN protocol_records a ON a.kind='keyring.accept' AND json_extract(a.record,'$.payload.request')=l.request_id WHERE l.sender=? OR l.recipient=?`).bind(account.identity,account.identity,account.identity,account.identity).all()).results;
 return reply({partners:rows.map(r=>({id:r.sender===account.identity?r.recipient:r.sender,origin:r.origin??url.origin,accepted:!!r.accepted&&!r.revoked,request:JSON.parse(r.request),...(r.accept?{accept:JSON.parse(r.accept)}:{})}))});
 }
 if(route==='/partners'&&method==='PUT'){
 const data=await read(request);exact(data,['partner','origin']);requireThat(validId(data.partner)&&typeof data.origin==='string',400,'Invalid partner origin');
 let origin;try{const u=new URL(data.origin);requireThat(u.protocol==='https:'||(env.MIMORI_LOCAL==='true'&&u.protocol==='http:'),400,'Invalid origin');origin=u.origin;}catch{throw new Fault(400,'Invalid origin');}
 requireThat(await one(db,'SELECT request_id FROM protocol_links WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)',account.identity,data.partner,data.partner,account.identity),403,'Unknown partner');
 await db.prepare('INSERT INTO protocol_partner_origins(identity,partner,origin) VALUES(?,?,?) ON CONFLICT(identity,partner) DO UPDATE SET origin=excluded.origin').bind(account.identity,data.partner,origin).run();return reply({ok:true});
 }
 if(route==='/prekeys/claim'&&method==='POST'){
 const data=await read(request);exact(data,['identity','device','claim']);requireThat(validId(data.identity)&&Number.isSafeInteger(data.device)&&data.device>=1&&data.device<=2147483647&&validHash(data.claim),400,'Invalid claim');
 const link=await one(db,'SELECT request_id FROM protocol_links WHERE accepted=1 AND revoked=0 AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?))',account.identity,data.identity,data.identity,account.identity);requireThat(link,403,'Mutual keyring acceptance required');
 let row=await one(db,'SELECT bundle,identity,device,claimed_by FROM protocol_prekeys WHERE claim_id=?',data.claim);
 if(row)requireThat(row.claimed_by===account.identity&&row.identity===data.identity&&row.device===String(data.device),409,'Claim already used');
 else row=await one(db,'UPDATE protocol_prekeys SET claimed_by=?,claim_id=? WHERE id=(SELECT id FROM protocol_prekeys WHERE identity=? AND device=? AND claim_id IS NULL ORDER BY id LIMIT 1) RETURNING bundle',account.identity,data.claim,data.identity,String(data.device));
 requireThat(row,409,'No one-time prekeys available; wait for partner');return reply(JSON.parse(row.bundle));
 }
 if(route==='/archive'&&method==='GET'){
 const cursor=url.searchParams.get('cursor')??'';requireThat(cursor===''||validHash(cursor),400,'Invalid archive cursor');
 const rows=(await db.prepare('SELECT id,revision,encrypted FROM protocol_archives WHERE identity=? AND id>? ORDER BY id LIMIT 50').bind(account.identity,cursor).all()).results;
 return reply({entries:rows.map(r=>({id:r.id,revision:r.revision,archive:JSON.parse(r.encrypted)})),cursor:rows.at(-1)?.id??cursor});
 }
 if(route.startsWith('/archive/')){
 const id=route.slice(9);requireThat(validHash(id),400,'Invalid archive ID');
 if(method==='GET'){const row=await one(db,'SELECT revision,encrypted FROM protocol_archives WHERE identity=? AND id=?',account.identity,id);requireThat(row,404,'No archive');return reply({revision:row.revision,archive:JSON.parse(row.encrypted)});}
 if(method==='PUT'){
 const data=await read(request);exact(data,['revision','archive']);requireThat(Number.isSafeInteger(data.revision)&&data.revision>=0,400,'Invalid revision');box(data.archive);
 const initial=await one(db,'INSERT INTO protocol_archives(identity,id,revision,encrypted) SELECT ?,?,1,? WHERE ?=0 ON CONFLICT(identity,id) DO NOTHING RETURNING revision',account.identity,id,canonical(data.archive),data.revision);
 const updated=initial??await one(db,'UPDATE protocol_archives SET revision=revision+1,encrypted=? WHERE identity=? AND id=? AND revision=? RETURNING revision',canonical(data.archive),account.identity,id,data.revision);requireThat(updated,409,'Archive changed; merge before saving');return reply(updated);
 }
 }
 if(route==='/vault'&&method==='GET'){const row=await one(db,'SELECT revision,encrypted FROM protocol_vaults WHERE identity=?',account.identity);requireThat(row,404,'No vault');const backup=await one(db,'SELECT encrypted FROM protocol_password_backups WHERE identity=?',account.identity);return reply({revision:row.revision,vault:JSON.parse(row.encrypted),...(backup?{previousVault:JSON.parse(backup.encrypted)}:{})});}
 if(route==='/vault'&&method==='PUT'){
 const data=await read(request);exact(data,['revision','vault']);requireThat(Number.isSafeInteger(data.revision)&&data.revision>=0,400,'Invalid revision');
 validateVault(data.vault,account.identity);
 const row=await one(db,'INSERT INTO protocol_vaults(identity,revision,encrypted) SELECT ?,1,? WHERE ?=0 ON CONFLICT(identity) DO NOTHING RETURNING revision',account.identity,canonical(data.vault),data.revision);
 const updated=row??await one(db,'UPDATE protocol_vaults SET revision=revision+1,encrypted=? WHERE identity=? AND revision=? RETURNING revision',canonical(data.vault),account.identity,data.revision);
 requireThat(updated,409,'Vault changed; reload before saving');return reply(updated);
 }
 if(route==='/records'&&method==='POST'){
 const record=await read(request);requireThat(await verifyRecord(record),400,'Invalid signature');validate(record,env.MIMORI_LOCAL==='true');
 if(record.author!==account.identity){
 if(record.kind==='keyring.request')requireThat(record.payload.recipient===account.identity,403,'Not your request');
 else if(['keyring.accept','keyring.remove'].includes(record.kind)){const link=await one(db,'SELECT sender,recipient FROM protocol_links WHERE request_id=?',record.payload.request);requireThat(link&&[link.sender,link.recipient].includes(account.identity),403,'Not your keyring');}
 else throw new Fault(400,'Invalid author');
 }
 const effects=[];
 if(record.kind.startsWith('keyring.')){
 if(record.kind==='keyring.request')effects.push(db.prepare('INSERT INTO protocol_links(request_id,sender,recipient) VALUES(?,?,?) ON CONFLICT(sender,recipient) DO NOTHING').bind(record.id,record.author,record.payload.recipient));
 else {const link=await one(db,'SELECT * FROM protocol_links WHERE request_id=?',record.payload.request);requireThat(link,404,'Unknown request');
 if(record.kind==='keyring.accept'){requireThat(link.recipient===record.author&&!link.revoked,403,'Cannot accept request');effects.push(db.prepare('UPDATE protocol_links SET accepted=1 WHERE request_id=? AND revoked=0').bind(link.request_id));}
 else {requireThat([link.sender,link.recipient].includes(record.author),403,'Cannot remove partner');effects.push(db.prepare('UPDATE protocol_links SET revoked=1 WHERE request_id=?').bind(link.request_id));}
 }
 }
 if(record.kind==='device.prekey')effects.push(db.prepare('INSERT INTO protocol_prekeys(id,identity,device,ec_id,kem_id,bundle) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(record.id,record.author,String(record.payload.device),record.payload.bundle.ecOneTimePreKey.keyId,record.payload.bundle.kemOneTimePreKey.keyId,canonical(record)));
 // Identity revisions require atomic previous-hash comparison, not arrival-order selection.
 if(record.kind==='identity'){
 const current=await one(db,"SELECT id,record FROM protocol_records WHERE author=? AND kind='identity' ORDER BY sequence DESC LIMIT 1",account.identity);
 if(current?.id===record.id)return reply({id:record.id});
 requireThat(current&&record.payload.previous===current.id&&record.payload.revision===JSON.parse(current.record).payload.revision+1,409,'Identity revision conflict');
 const result=await db.prepare("INSERT INTO protocol_records(id,author,kind,record,created_at) SELECT ?,?,?,?,? WHERE (SELECT id FROM protocol_records WHERE author=? AND kind='identity' ORDER BY sequence DESC LIMIT 1)=? ON CONFLICT(id) DO NOTHING").bind(record.id,record.author,record.kind,canonical(record),Date.now(),record.author,current.id).run();requireThat(result.meta.changes===1,409,'Identity revision conflict');
 }else await db.batch([...effects,db.prepare('INSERT INTO protocol_records(id,author,kind,recipient,record,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(record.id,record.author,record.kind,record.payload.recipient??null,canonical(record),Date.now())]);
 return reply({id:record.id},201);
 }
 return reply({error:'Not found'},404);
 }catch(e){if(e instanceof Fault)return reply({error:e.message},e.status);return reply({error:'Protocol request failed'},500);}
}
