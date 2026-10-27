// AES uses native WebCrypto in the worker. WASM supplies password derivation.
// Optional AES overrides are retained for ciphertext compatibility tests.
let engine=null;
export function installCryptoEngine(next){engine=next;}
export function cryptoEngine(){return engine;}
export async function encryptBytes(key,nonce,plaintext,aad){
 if(engine?.encrypt)return engine.encrypt(key,nonce,plaintext,aad);
 const imported=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);
 return new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad},imported,plaintext));
}
export async function decryptBytes(key,nonce,ciphertext,aad){
 if(engine?.decrypt)return engine.decrypt(key,nonce,ciphertext,aad);
 const imported=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['decrypt']);
 return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:aad},imported,ciphertext));
}
