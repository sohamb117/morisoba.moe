export const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function encryptionKey(env){const source=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BOOKING_GOOGLE_CLIENT_SECRET),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('morisoba-control-calendar-v1'),info:new TextEncoder().encode('oauth-storage')},source,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function seal(value,env){const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(env),new TextEncoder().encode(value));return b64(iv)+'.'+b64(cipher);}
export async function unseal(value,env){const [iv,cipher]=value.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await encryptionKey(env),unb64(cipher)));}
