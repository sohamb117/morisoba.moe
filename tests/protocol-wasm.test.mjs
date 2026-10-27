import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {enableWasm} from '../protocol/wasm-backend.mjs';
import {installCryptoEngine} from '../protocol/crypto-engine.mjs';
import {seal,open,randomKey,unb64,b64} from '../protocol/records.mjs';
import {createVault,unlockVault,changeVaultPassword} from '../protocol/vault.mjs';
const bytes=await readFile(new URL('../mimori/crypto/mimori_crypto_bg.wasm',import.meta.url));
test('WASM AES-GCM reads existing ciphertext; native AES reads WASM; authentication is preserved',async()=>{
 const key=randomKey(),value={body:'existing post 日本語',nested:[1,true]},aad={purpose:'social-body',author:'existing'};
 try{
 installCryptoEngine(null);const old=await seal(key,value,aad);
 await enableWasm(bytes);assert.deepEqual(await open(key,old,aad),value);
 const next=await seal(key,value,aad);assert.deepEqual(await open(key,next,aad),value);
 await assert.rejects(open(randomKey(),next,aad));await assert.rejects(open(key,next,{...aad,author:'other'}));
 const damaged=unb64(next.ciphertext);damaged[0]^=1;await assert.rejects(open(key,{...next,ciphertext:b64(damaged)},aad));
 installCryptoEngine(null);assert.deepEqual(await open(key,next,aad),value);
 }finally{installCryptoEngine(null);}
});
test('legacy vault and WASM vault have identical password semantics, including password changes',async()=>{
 const password='same password 日本語 2026!',nextPassword='replacement password 日本語!',contents={identity:{id:'unchanged',privateKey:'preserved'},archiveKey:'preserved'};
 try{
 installCryptoEngine(null);const old=await createVault('owner',password,contents);
 await enableWasm(bytes);assert.deepEqual(await unlockVault(old,'owner',password),contents);
 await assert.rejects(unlockVault(old,'owner',password+'wrong'));
 const next=await changeVaultPassword(old,'owner',password,nextPassword);
 const fresh=await createVault('owner',password,contents);
 installCryptoEngine(null);assert.deepEqual(await unlockVault(next,'owner',nextPassword),contents);assert.deepEqual(await unlockVault(fresh,'owner',password),contents);
 }finally{installCryptoEngine(null);}
});
