import {createSignalProtocolClient,ProtocolAddress} from '@open-e2ee/signal-protocol-sdk';
import {createCompositeIdentityV1,generateEcSignedPreKey,generateEcOneTimePreKeys,generateKemOneTimePreKeys} from '@open-e2ee/signal-protocol-sdk/keys';
import {canonical,signRecord,verifyRecord} from './records.mjs';
// This suite is deliberately NOT advertised as the draft's unfrozen classical suite.
// The pinned library requires PQXDH and its braid ratchet; no downgrade is allowed.
export const SUITE='mimori-open-e2ee-13.2.0-experimental';
export async function createRatchet({identity,deviceId=1,storage}){
 const client=await createSignalProtocolClient({identity:{userId:identity.id,deviceId},adapters:{storage},protocol:{postQuantum:'required',braid:'required',contentRecovery:{mode:'off'}},ratchetConfig:{maxSkip:1000,keyExpirationMs:7*86400000},enableDebugLogging:false});
 return {
 client,
 async replenish(count=10){
 if(!Number.isSafeInteger(count)||count<1||count>50)throw Error('Invalid prekey count');
 const keys=await storage.getIdentityKey();
 if(!await storage.getEcSignedPreKey())await storage.storeEcSignedPreKey(await generateEcSignedPreKey(keys));
 const raw=await storage.getMetadata('mimori:prekey-counter'),start=raw===null?1:Number(raw);
 // Reserve IDs first; a crash may leave gaps but can never reuse a consumed ID.
 await storage.setMetadata('mimori:prekey-counter',String(start+count));
 await storage.storeEcOneTimePreKeys(await generateEcOneTimePreKeys(count,start));
 await storage.storeKemOneTimePreKeys(await generateKemOneTimePreKeys(keys,count,start));
 },
 async bundles(){
 const keys=await storage.getIdentityKey(),signed=await storage.getEcSignedPreKey(),ec=await storage.getEcOneTimePreKeys(),kem=await storage.getKemOneTimePreKeys();
 if(!signed||!ec.length||!kem.length)throw Error('One-time prekeys must be replenished');
 const pub=k=>({keyId:k.keyId,publicKey:k.publicKey,...(k.signature?{signature:k.signature}:{})});
 const composite=createCompositeIdentityV1(keys);
 return Promise.all(ec.slice(0,Math.min(ec.length,kem.length)).map((key,i)=>signRecord(identity,'device.prekey',{suite:SUITE,device:deviceId,bundle:{registrationId:keys.registrationId,deviceId,identity:composite,ecSignedPreKey:pub(signed),ecOneTimePreKey:pub(key),kemOneTimePreKey:pub(kem[i])}})));
 },
 async connect(record,expectedIdentity){
 if(!await verifyRecord(record)||record.author!==expectedIdentity||record.kind!=='device.prekey'||record.payload.suite!==SUITE)throw Error('Invalid device certificate');
 const {bundle,device}=record.payload;if(!bundle.ecOneTimePreKey||!bundle.kemOneTimePreKey||bundle.deviceId!==device)throw Error('One-time prekey required');
 await client.establishSession(ProtocolAddress.create(expectedIdentity,device),bundle);
 },
 async encrypt(partner,device,content){return client.encryptMessage(ProtocolAddress.create(partner,device),canonical(content));},
 async decrypt(partner,device,ciphertext){return JSON.parse(await client.decryptMessage(ProtocolAddress.create(partner,device),ciphertext));},
 async stop(){await client.stop();}
 };
}
