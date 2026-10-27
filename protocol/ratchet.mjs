import {createSignalProtocolClient,ProtocolAddress} from '@open-e2ee/signal-protocol-sdk';
import {createCompositeIdentityV1,generateEcSignedPreKey,generateEcOneTimePreKeys,generateKemOneTimePreKeys} from '@open-e2ee/signal-protocol-sdk/keys';
import {canonical,signRecord,verifyRecord} from './records.mjs';
// This suite is deliberately NOT advertised as the draft's unfrozen classical suite.
// The pinned library requires PQXDH and its braid ratchet; no downgrade is allowed.
export const SUITE='mimori-open-e2ee-13.2.0-experimental';
// Transport identities are per browser, authenticated by the stable account's
// signed prekey record. Device 1 retains the original wire address unchanged.
const address=(identity,device)=>ProtocolAddress.create(device===1?identity:identity+'/device/'+device,1);
export async function createRatchet({identity,deviceId=1,storage}){
 const client=await createSignalProtocolClient({identity:{userId:address(identity.id,deviceId).userId,deviceId:1},adapters:{storage},protocol:{postQuantum:'required',braid:'required',contentRecovery:{mode:'off'}},ratchetConfig:{maxSkip:1000,keyExpirationMs:7*86400000},enableDebugLogging:false});
 return {
 client,
 hasSession:(partner,device)=>client.hasSession(address(partner,device)),
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
 async bundles({allowEmpty=false}={}){
 const keys=await storage.getIdentityKey(),signed=await storage.getEcSignedPreKey(),ec=await storage.getEcOneTimePreKeys(),kem=await storage.getKemOneTimePreKeys();
 if(!signed||!ec.length||!kem.length){if(allowEmpty)return [];throw Error('One-time prekeys must be replenished');}
 const pub=k=>({keyId:k.keyId,publicKey:k.publicKey,...(k.signature?{signature:k.signature}:{})});
 const composite=createCompositeIdentityV1(keys);
 return Promise.all(ec.slice(0,Math.min(ec.length,kem.length)).map((key,i)=>signRecord(identity,'device.prekey',{suite:SUITE,device:deviceId,...(deviceId!==1?{addressing:'per-device-v1'}:{}),bundle:{registrationId:keys.registrationId,deviceId:1,identity:composite,ecSignedPreKey:pub(signed),ecOneTimePreKey:pub(key),kemOneTimePreKey:pub(kem[i])}})));
 },
 async connect(record,expectedIdentity){
 if(!await verifyRecord(record)||record.author!==expectedIdentity||record.kind!=='device.prekey'||record.payload.suite!==SUITE)throw Error('Invalid device certificate');
 const {bundle,device}=record.payload;if(!bundle.ecOneTimePreKey||!bundle.kemOneTimePreKey||bundle.deviceId!==1||(device!==1&&record.payload.addressing!=='per-device-v1'))throw Error('One-time prekey required');
 await client.establishSession(address(expectedIdentity,device),bundle);
 },
 async encrypt(partner,device,content){return client.encryptMessage(address(partner,device),canonical(content));},
 async decrypt(partner,device,ciphertext){return JSON.parse(await client.decryptMessage(address(partner,device),ciphertext));},
 async stop(){await client.stop();}
 };
}
