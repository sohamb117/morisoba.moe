export async function mapLimit(items,limit,fn){
 const results=new Array(items.length);let cursor=0;
 const workers=await Promise.allSettled(Array.from({length:Math.min(limit,items.length)},async()=>{
  while(cursor<items.length){const i=cursor++;results[i]=await fn(items[i],i);}
 }));
 const failed=workers.find(r=>r.status==='rejected');if(failed)throw failed.reason;return results;
}
