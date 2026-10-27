import init,{derive_password} from '../mimori/crypto/mimori_crypto.js';
import {installCryptoEngine} from './crypto-engine.mjs';
export async function enableWasm(bytes){
 const source=bytes??(typeof __MIMORI_WASM_URL__==='string'?__MIMORI_WASM_URL__:'/mimori/crypto/mimori_crypto_bg.wasm');
 await init({module_or_path:source});
 installCryptoEngine({derive(password,salt){
  const encoded=new TextEncoder().encode(password);
  try{return derive_password(encoded,salt);}finally{encoded.fill(0);}
 }});
}
