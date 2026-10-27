// Replies stay inside their root conversation, even when the root was deleted.
export function buildThreads(posts){
 const threads=new Map();
 for(const record of posts){
  const key=record.payload.type==='reply'?record.payload.root:record.id;
  if(!threads.has(key))threads.set(key,{id:key,post:null,replies:[]});
  const thread=threads.get(key);
  if(record.payload.type==='reply')thread.replies.push(record);else thread.post=record;
 }
 const ascending=(a,b)=>a.payload.createdAt-b.payload.createdAt||a.id.localeCompare(b.id);
 for(const thread of threads.values())thread.replies.sort(ascending);
 return [...threads.values()].sort((a,b)=>{
  const time=t=>t.post?.payload.createdAt??t.replies[0].payload.createdAt;
  return time(b)-time(a)||a.id.localeCompare(b.id);
 });
}
