import {canonical} from './records.mjs';
const BASE='/api/mimori/v1';
export class ProviderClient {
 constructor(origin,{csrf,fetch:transport=globalThis.fetch.bind(globalThis)}={}){this.origin=new URL(origin).origin;this.csrf=csrf;this.fetch=transport;}
 async request(path,{data,method=data===undefined?'GET':'POST',privateAccess=false}={}){
 const response=await this.fetch(this.origin+BASE+path,{method,credentials:privateAccess?'same-origin':'omit',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(privateAccess&&this.csrf?{'X-CSRF-Token':this.csrf}:{})},body:data===undefined?undefined:canonical(data)});
 const result=await response.json();if(!response.ok)throw Error(result.error??'Provider request failed');return result;
 }
 publish(record){return this.request('/records',{data:record,privateAccess:true});}
}
