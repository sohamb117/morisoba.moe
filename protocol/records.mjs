import {encryptBytes,decryptBytes} from './crypto-engine.mjs';
import {canonicalize} from 'json-canonicalize/bundles/index.umd.js';
export const VERSION = 'mimori/0.1-experimental';
export const encode = value => new TextEncoder().encode(value);
export const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export function unb64(value, length) {
  if(typeof value!=='string'||!value.length||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid base64url');
  const bytes=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
  if(b64(bytes)!==value||(length!==undefined&&bytes.length!==length))throw Error('Invalid encoding length');
  return bytes;
}
export function canonical(value) {
  function check(v,depth=0){
    if(depth>24)throw Error('Record too deep');
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='string'){if(!v.isWellFormed())throw Error('Invalid Unicode');return;}
    if(typeof v==='number'){if(!Number.isSafeInteger(v)||Object.is(v,-0))throw Error('Only safe integers');return;}
    if(Array.isArray(v)){for(const item of v)check(item,depth+1);return;}
    if(typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype){for(const [k,item] of Object.entries(v)){check(k,depth+1);check(item,depth+1);}return;}
    throw Error('Invalid JSON value');
  }
  check(value);return canonicalize(value);
}
export const hash = async bytes => b64(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
export const identityId = async publicKey => 'mimori:1:'+await hash(unb64(publicKey,32));
export async function createIdentity(){
  const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const publicKey=b64(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)));
  const privateKey=b64(new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey)));
  return {id:await identityId(publicKey),publicKey,privateKey};
}
export async function signRecord(identity,kind,payload){
  const record={version:VERSION,kind,author:identity.id,publicKey:identity.publicKey,payload};
  const key=await crypto.subtle.importKey('pkcs8',unb64(identity.privateKey),'Ed25519',false,['sign']);
  const signature=b64(new Uint8Array(await crypto.subtle.sign('Ed25519',key,encode(canonical(record)))));
  const signed={...record,signature};return {...signed,id:await hash(encode(canonical(signed)))};
}
export async function verifyRecord(record){
  try{
    if(!record||Object.keys(record).sort().join(',')!=='author,id,kind,payload,publicKey,signature,version'||record.version!==VERSION)return false;
    if(record.author!==await identityId(record.publicKey))return false;
    const {id,signature,...unsigned}=record;
    if(id!==await hash(encode(canonical({...unsigned,signature}))))return false;
    const key=await crypto.subtle.importKey('raw',unb64(record.publicKey,32),'Ed25519',false,['verify']);
    return await crypto.subtle.verify('Ed25519',key,unb64(signature,64),encode(canonical(unsigned)));
  }catch{return false;}
}
export function randomKey(){return crypto.getRandomValues(new Uint8Array(32));}
export async function seal(key,value,context){
  const nonce=crypto.getRandomValues(new Uint8Array(12));
  const plaintext=encode(canonical(value));
  let ciphertext;try{ciphertext=await encryptBytes(key,nonce,plaintext,encode(canonical(context)));}finally{plaintext.fill(0);}
  return {nonce:b64(nonce),ciphertext:b64(new Uint8Array(ciphertext))};
}
export async function open(key,box,context){
  const plain=await decryptBytes(key,unb64(box.nonce,12),unb64(box.ciphertext),encode(canonical(context)));
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));}finally{plain.fill(0);}
}
