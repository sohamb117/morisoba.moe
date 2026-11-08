const memory=new Map(),pending=new Map();let store=null;
export function setCacheStore(value){store=value;}
export async function cached(key,ttl,loader){
  let hit=memory.get(key);
  if(!hit&&store){try{hit=JSON.parse(await store.get(key));if(hit)memory.set(key,hit);}catch{}}
  if(hit&&hit.expires>Date.now())return hit.value;
  if(pending.has(key))return pending.get(key);
  const promise=(async()=>{try{const value=await loader();const row={value,expires:Date.now()+ttl*1000};if(memory.size>500)memory.delete(memory.keys().next().value);memory.set(key,row);if(store)await store.put(key,JSON.stringify(row),{expirationTtl:Math.max(ttl*4,86400)}).catch(()=>{});return value;}catch(error){if(hit){hit.expires=Date.now()+60000;return hit.value;}throw error;}finally{pending.delete(key);}})();pending.set(key,promise);return promise;
}

export async function cacheValue(key,value,ttl){const row={value,expires:Date.now()+ttl*1000};memory.set(key,row);if(store)await store.put(key,JSON.stringify(row),{expirationTtl:Math.max(ttl*4,86400)}).catch(()=>{});}
export async function readCached(key){let row=memory.get(key);if(!row&&store){try{row=JSON.parse(await store.get(key));}catch{}}return row&&row.expires>Date.now()?row.value:null;}
