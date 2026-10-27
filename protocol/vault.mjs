import {cryptoEngine} from './crypto-engine.mjs';
import {argon2idAsync} from '@noble/hashes/argon2.js';
import {b64,unb64,randomKey,seal,open,VERSION} from './records.mjs';
const KDF=Object.freeze({name:'argon2id',m:65536,t:3,p:4,dkLen:32});
const context=owner=>({version:VERSION,purpose:'identity-vault',owner});
async function derive(password,salt){
 if(typeof password!=='string'||password.length<12||password.length>1024)throw Error('Use a password of 12–1024 characters');
 return cryptoEngine()?.derive(password,unb64(salt,16))??argon2idAsync(password,unb64(salt,16),KDF);
}
export async function createVault(owner,password,contents){
 const salt=b64(crypto.getRandomValues(new Uint8Array(16))),master=randomKey(),key=await derive(password,salt);
 try{return {version:1,owner,kdf:{...KDF,salt},wrapped:await seal(key,{master:b64(master)},context(owner)),contents:await seal(master,contents,{...context(owner),purpose:'vault-contents'})};}
 finally{key.fill(0);master.fill(0);}
}
function validate(vault,owner){
 if(vault.version!==1||vault.owner!==owner||Object.keys(KDF).some(k=>vault.kdf?.[k]!==KDF[k]))throw Error('Unsupported vault');
}
export async function unlockVault(vault,owner,password){
 validate(vault,owner);const key=await derive(password,vault.kdf.salt);let master;
 try{master=unb64((await open(key,vault.wrapped,context(owner))).master,32);return await open(master,vault.contents,{...context(owner),purpose:'vault-contents'});}
 finally{key.fill(0);master?.fill(0);}
}
// Password changes rewrap the same master key; they never reset active sessions.
export async function changeVaultPassword(vault,owner,oldPassword,newPassword){
 validate(vault,owner);const oldKey=await derive(oldPassword,vault.kdf.salt);let nextKey,master;
 try{master=await open(oldKey,vault.wrapped,context(owner));const salt=b64(crypto.getRandomValues(new Uint8Array(16)));nextKey=await derive(newPassword,salt);return {...vault,kdf:{...KDF,salt},wrapped:await seal(nextKey,master,context(owner))};}
 finally{oldKey.fill(0);nextKey?.fill(0);}
}
