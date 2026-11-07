import {appendChatText} from './chat-media.js';
import {buildThreads} from '../protocol/threads.mjs';
export async function initChat({client,provider,owner}){
const $=s=>document.querySelector(s),status=text=>{$('#chat-status').textContent=text;};
let legacyPosts=[];const running=new WeakSet();
async function busy(fn,scope){if(scope&&running.has(scope))return;const buttons=scope?.matches?.('button')?[scope]:[...(scope?.querySelectorAll?.('button')||[])];if(scope)running.add(scope);buttons.forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message);}finally{buttons.forEach(b=>b.disabled=false);if(scope)running.delete(scope);}}
const replyDrafts=new Map(),sendingReplies=new Set();
async function render(){
 const view=await client.view(),feed=document.querySelector('#chat-feed');feed.replaceChildren();
 const imported=new Set(view.posts.filter(r=>r.author===client.identity.id&&r.payload.legacy).map(r=>r.payload.legacy.id));
 const timeline=[...view.posts,...legacyPosts.filter(p=>!imported.has(p.id)).map(p=>({id:'original-'+p.id,author:client.identity.id,payload:{body:p.body,createdAt:p.created_at,audience:[],original:true}}))];
 const records=new Map(timeline.map(r=>[r.id,r]));
 const name=author=>view.profiles.get(author)?.payload.displayName??(author===client.identity.id?owner.displayName:author.slice(-12));
 function drawPost(record){
  const article=document.createElement('article');article.className='post';article.id='post-'+record.id;
  if(record.payload.type==='reply'){
   article.classList.add('thread-reply');
   const parent=records.get(record.payload.target),context=document.createElement(parent?'a':'span');
   context.className='reply-context';context.textContent=parent?'Replying to '+name(parent.author):'Replying to an unavailable post';
   if(parent)context.href='#post-'+parent.id;
   article.append(context);
  }
  const meta=document.createElement('div');meta.className='post-meta';meta.textContent=name(record.author)+' · '+new Date(record.payload.createdAt).toLocaleString();
  const body=document.createElement('p');body.className='post-body';appendChatText(body,record.payload.body);article.append(meta,body);
  if(record.payload.audience.includes(client.identity.id)){
   const actions=document.createElement('div');actions.className='post-actions';
   const liked=view.likes.get(record.id)?.has(client.identity.id),like=document.createElement('button');
   like.textContent=(liked?'Unlike':'Like')+' ('+(view.likes.get(record.id)?.size??0)+')';
   like.onclick=()=>busy(async()=>{await client.like(record.id,{remove:liked});await render();await client.flush();},like);
   const reply=document.createElement('button');reply.textContent='Reply';reply.setAttribute('aria-expanded',String(replyDrafts.has(record.id)));
   const editorId='reply-'+record.id;reply.setAttribute('aria-controls',editorId);
   function showEditor(){
    const existing=article.querySelector('.reply-form');if(existing){existing.querySelector('textarea').focus();return;}
    if(!replyDrafts.has(record.id))replyDrafts.set(record.id,{text:'',queued:false});
    const draft=replyDrafts.get(record.id),form=document.createElement('form'),input=document.createElement('textarea');
    form.className='reply-form';form.id=editorId;input.required=true;input.maxLength=10000;input.rows=3;input.value=draft.text;
    input.setAttribute('aria-label','Reply to '+name(record.author));input.disabled=draft.queued;
    input.oninput=()=>{draft.text=input.value;};
    const controls=document.createElement('div');controls.className='reply-controls';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent=draft.queued?'Close':'Cancel';
    cancel.onclick=()=>{replyDrafts.delete(record.id);form.remove();reply.setAttribute('aria-expanded','false');reply.focus();};
    const send=document.createElement('button');send.type='submit';send.textContent=draft.queued?'Retry sending':'Send reply';
    controls.append(cancel,send);form.append(input,controls);article.append(form);reply.setAttribute('aria-expanded','true');
    form.onsubmit=e=>{
     e.preventDefault();if(sendingReplies.has(record.id))return;sendingReplies.add(record.id);
     busy(async()=>{
      try{
       if(!draft.queued){await client.reply(record.id,input.value);draft.queued=true;input.disabled=true;}
       await client.flush();replyDrafts.delete(record.id);await render();status('Reply sent.');
      }catch(error){if(draft.queued){send.textContent='Retry sending';cancel.textContent='Close';}throw error;}
      finally{sendingReplies.delete(record.id);}
     },form);
    };
   }
   reply.onclick=()=>{showEditor();article.querySelector('textarea')?.focus();};
   actions.append(like,reply);article.append(actions);if(replyDrafts.has(record.id))showEditor();
  }else if(!record.payload.original){const note=document.createElement('small');note.textContent='Shared history';article.append(note);}
  return article;
 }
 for(const thread of buildThreads(timeline)){
  const section=document.createElement('section');section.className='thread';section.setAttribute('aria-label','Post and replies');
  if(thread.post)section.append(drawPost(thread.post));
  else{const missing=document.createElement('p');missing.className='missing-post';missing.textContent='Original post unavailable';section.append(missing);}
  if(thread.replies.length){
   const replies=document.createElement('div');replies.className='thread-replies';
   for(const reply of thread.replies)replies.append(drawPost(reply));section.append(replies);
  }
  feed.append(section);
 }
}

$('#chat-unlocked').hidden=false;
$('#chat-compose').onsubmit=e=>{e.preventDefault();const f=e.target;busy(async()=>{const draft=f.elements.body.value;await client.refreshPartners();await client.post(draft);if(f.elements.body.value===draft)f.elements.body.value='';await render();await client.flush();status('');},f);};
$('#chat-retry').onclick=e=>busy(async()=>{await client.flush();await render();status('');},e.target);
$('#chat-refresh').onclick=e=>busy(async()=>{await client.restoreArchive();await client.refreshPartners();await client.sync();await client.flush();await render();status('');},e.target);
await render();
try{legacyPosts=(await provider.request('/legacy-export',{privateAccess:true})).posts.filter(p=>!p.deleted_at);await client.restoreArchive();await render();await client.refreshPartners();await client.sync();await render();await client.flush();await client.publishPrekeys();}catch(e){status(e.message);}
}
