import wasmBytes from '../mimori/crypto/mimori_crypto_bg.wasm';
import {enableWasm} from './wasm-backend.mjs';
import {ProviderClient,signInIdentity,openProtocolClient} from './client.mjs';
const ready=enableWasm(wasmBytes);
const methods=new Set(['partners','refreshPartners','publishPrekeys','requestPartner','acceptPartner','confirmPartner','connect','post','profile','reply','like','removePartner','backupArchive','restoreArchive','deletePost','flush','sync','view','history','replay']);
let client,provider,queue=Promise.resolve();
self.onmessage=({data})=>{
 queue=queue.then(async()=>{
  try{
   await ready;let value;
   if(data.method==='init'){
    if(client)throw Error('Already signed in');
    provider=new ProviderClient(data.origin,{csrf:data.csrf});
    const secrets=await signInIdentity(provider,data.password);data.password=null;
    client=await openProtocolClient({provider,secrets,automaticDevice:true});
    value={identity:{id:client.identity.id},deviceId:client.deviceId};
   }else{
    if(!client||!methods.has(data.method))throw Error('Unavailable operation');
    provider.csrf=data.csrf;value=await client[data.method](...data.args);
   }
   self.postMessage({id:data.id,value});
  }catch(error){self.postMessage({id:data.id,error:error.message});}
 });
};
