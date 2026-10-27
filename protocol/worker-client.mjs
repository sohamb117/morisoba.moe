export async function openWorkerClient(provider,password){
 const worker=new Worker(__MIMORI_WORKER_URL__,{type:'module'}),pending=new Map();let sequence=0,closed=false;
 function stop(error=Error('Signed out')){closed=true;worker.terminate();for(const p of pending.values())p.reject(error);pending.clear();}
 worker.onerror=()=>stop(Error('Unable to start encryption. Reload and try again.'));
 worker.onmessageerror=()=>stop(Error('Encryption worker communication failed. Reload and try again.'));
 worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.value);};
 function call(method,args=[],extra={}){if(closed)return Promise.reject(Error('Signed out'));return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,method,args,csrf:provider.csrf,...extra});});}
 try{
  const details=await call('init',[],{origin:provider.origin,password});password=null;
  const target={...details,provider,close:async()=>stop()};
  return new Proxy(target,{get:(object,key)=>key==='then'?undefined:key in object?object[key]:(...args)=>call(key,args)});
 }catch(error){stop(error);throw error;}
}
