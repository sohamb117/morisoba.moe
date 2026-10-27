import {buildThreads} from './threads.mjs';
import {ProviderClient,signInIdentity,openProtocolClient} from './client.mjs';
import {verifyRecord} from './records.mjs';
const $=id=>document.getElementById(id),status=text=>{$('page-status').textContent=text;};
let user,provider,client,legacyPosts=[],partners=new Map();
async function busy(fn){const buttons=[...document.querySelectorAll('button')],previous=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message);}finally{buttons.forEach((b,i)=>b.disabled=previous[i]);}}
const form=(id,fn)=>$(id).addEventListener('submit',e=>{e.preventDefault();busy(fn);});
const click=(id,fn)=>$(id).addEventListener('click',()=>busy(fn));
async function accountRequest(path,{method='GET',data}={}){
 const r=await fetch('/api/mimorigasaka'+path,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':provider.csrf},body:data===undefined?undefined:JSON.stringify(data)}),result=await r.json();
 if(!r.ok)throw Error(result.error??'Account request failed');return result;
}
async function session(){
 const r=await fetch('/api/mimorigasaka/session',{cache:'no-store'}),s=await r.json();
 if(!r.ok)throw Error(s.error??'Unable to check account');
 if(s.user){
 user=s.user;provider=new ProviderClient(location.origin,{csrf:s.csrf});
 $('account').hidden=false;$('username').value=user.username;
 $('account-name').textContent='Signed in as @'+user.username;$('identity-toggle').textContent='C:'+user.username+'>';
 $('account-admin').hidden=user.role!=='admin';
 }
}
click('invite-people',async()=>{
 const result=await accountRequest('/invites',{method:'POST',data:{}});
 $('account-invite-link').value=location.origin+'/mimorigasaka/#invite='+result.token;
 $('account-invite').hidden=false;status('Copy this private invitation link. It is shown only once.');
});
click('copy-account-invite',async()=>{try{await navigator.clipboard.writeText($('account-invite-link').value);status('Invitation copied.');}catch{$('account-invite-link').select();status('Select and copy the invitation link.');}});
click('sign-out',async()=>{await accountRequest('/logout',{method:'POST',data:{}});if(client)await client.close();location.reload();});
form('login-form',async()=>{
 const password=$('password').value;status('Signing in…');
 try{
 const r=await fetch('/api/mimorigasaka/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('username').value,password})}),data=await r.json();
 if(!r.ok)throw Error(data.error??'Login failed');
 await session();await activate(await signInIdentity(provider,password));
 }finally{$('password').value='';}
});
async function activate(secrets){
 client=await openProtocolClient({provider,secrets,automaticDevice:true});
 await client.restoreArchive();await client.refreshPartners();
 legacyPosts=(await provider.request('/legacy-export',{privateAccess:true})).posts.filter(p=>!p.deleted_at);
 $('login-form').hidden=true;$('profile').hidden=false;$('identity').classList.add('signed-in');$('feed-lock').hidden=true;
 $('identity-title').textContent=user.displayName;$('identity-toggle').textContent='C:'+user.username+'>';$('profile-handle').textContent='@'+user.username;$('name').value=user.displayName;$('bio').value=user.bio??'';$('profile-bio').textContent=user.bio??'';$('fingerprint').textContent=client.identity.id;
 $('profile-picture').src=user.avatarVersion?'/api/mimorigasaka/avatars/'+user.id+'?v='+user.avatarVersion:'/shared/morisoba-lily.svg';
 await client.publishPrekeys();await client.flush();status('');if(matchMedia('(max-width:650px)').matches){$('identity').hidden=true;$('identity-toggle').setAttribute('aria-expanded','false');}await render();partners=new Map(Object.entries(await client.partners()));renderPartners();
 try{await client.sync();await render();}catch(e){status('Signed in. '+e.message);}
 const params=new URLSearchParams(location.search);if(params.has('request')&&params.has('provider')){
 const remote=new ProviderClient(params.get('provider')),record=await remote.request('/objects/'+params.get('request'));if(!await verifyRecord(record))throw Error('Invalid partner request');
 const button=document.createElement('button');button.textContent='Accept '+record.author.slice(-12);button.onclick=()=>busy(async()=>{await client.acceptPartner(record,remote.origin);partners.set(record.author,{origin:remote.origin,accepted:true});button.remove();status('Accepted. Your partner can now connect.');renderPartners();});$('partners').append(button);$('identity').hidden=false;
 }
}
$('identity-toggle').onclick=()=>{const panel=$('identity');panel.hidden=false;$('identity-toggle').setAttribute('aria-expanded','true');panel.querySelector('input:not([hidden])')?.focus();};
form('password-form',async()=>{
 await accountRequest('/password',{method:'POST',data:{currentPassword:$('current-password').value,password:$('new-password').value}});
 $('current-password').value='';$('new-password').value='';await session();if(client)client.provider.csrf=provider.csrf;status('Password changed.');
});
form('post-form',async()=>{await client.refreshPartners();await client.post($('draft').value);await client.flush();$('draft').value='';await render();status('Posted.');});
form('profile-form',async()=>{await client.profile($('name').value,$('bio').value);await client.flush();$('profile-bio').textContent=$('bio').value;$('identity-title').textContent=$('name').value;$('profile-form').hidden=true;await render();status('Profile shared with your keyring.');});
click('edit-profile',async()=>{$('profile-form').hidden=!$('profile-form').hidden;});
click('copy-address',async()=>{const url=new URL(location.pathname,location.origin);url.searchParams.set('identity',client.identity.id);url.searchParams.set('provider',location.origin);await navigator.clipboard.writeText(url.href);status('Identity link copied.');});
form('partner-form',async()=>{const url=new URL($('partner-link').value),id=url.searchParams.get('identity'),origin=url.searchParams.get('provider')??url.origin;if(!id)throw Error('This link has no identity');const request=await client.requestPartner(id,origin);partners.set(id,{origin,accepted:false,request});const link=new URL(location.pathname,origin);link.searchParams.set('request',request.id);link.searchParams.set('provider',location.origin);const a=document.createElement('a');a.href=link.href;a.textContent='Partner acceptance link';$('partner-result').replaceChildren(a);renderPartners();});
function renderPartners(){const list=$('partners');list.replaceChildren();for(const [id,p] of partners){const row=document.createElement('div');row.className='partner';row.textContent=id.slice(-12)+(p.accepted?' · accepted':' · pending');
 const connect=document.createElement('button');connect.textContent=p.accepted?'Connect':'Check acceptance';connect.onclick=()=>busy(async()=>{if(!p.accepted){const remote=new ProviderClient(p.origin);let cursor=0,found;for(let i=0;i<20;i++){const page=await remote.request('/records?cursor='+cursor);found=page.records.find(r=>r.kind==='keyring.accept'&&r.author===id&&r.payload.request===p.request.id);if(found||page.cursor===cursor)break;cursor=page.cursor;}if(!found)throw Error('Your partner has not accepted yet');await client.confirmPartner(found);p.accepted=true;}await client.connect(id);status('Connected.');renderPartners();});
 const share=document.createElement('button');share.textContent='Share';share.onclick=()=>busy(async()=>{if(!$('share-history').checked)throw Error('Select Share older posts first');const job=await client.history(id,{shareOlderPosts:true});if(!confirm('Share '+job.total+' older posts with '+id.slice(-12)+'?'))return;let next=job;while(next.status!=='complete'&&next.status!=='paused'){next=await client.replay(next.id);await client.flush();status('History: '+next.cursor+' / '+next.total);}status('History '+next.status+'.');$('share-history').checked=false;});row.append(connect,share);list.append(row);}}
const replyDrafts=new Map(),sendingReplies=new Set();
async function render(){
 const view=await client.view(),feed=$('feed');feed.replaceChildren();
 const imported=new Set(view.posts.filter(r=>r.author===client.identity.id&&r.payload.legacy).map(r=>r.payload.legacy.id));
 const timeline=[...view.posts,...legacyPosts.filter(p=>!imported.has(p.id)).map(p=>({id:'original-'+p.id,author:client.identity.id,payload:{body:p.body,createdAt:p.created_at,audience:[],original:true}}))];
 const records=new Map(timeline.map(r=>[r.id,r]));
 const name=author=>view.profiles.get(author)?.payload.displayName??(author===client.identity.id?user.displayName:author.slice(-12));
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
  const body=document.createElement('p');body.className='post-body';body.textContent=record.payload.body;article.append(meta,body);
  if(record.payload.audience.includes(client.identity.id)){
   const actions=document.createElement('div');actions.className='post-actions';
   const liked=view.likes.get(record.id)?.has(client.identity.id),like=document.createElement('button');
   like.textContent=(liked?'Unlike':'Like')+' ('+(view.likes.get(record.id)?.size??0)+')';
   like.onclick=()=>busy(async()=>{await client.like(record.id,{remove:liked});await client.flush();await render();});
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
     });
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
click('refresh',async()=>{if(!client)return;await client.restoreArchive();await client.refreshPartners();await client.sync();await client.flush();await render();status('Updated.');});
const mobile=matchMedia('(max-width:650px)');
 $('identity').hidden=mobile.matches;$('identity-toggle').setAttribute('aria-expanded',String(!mobile.matches));
 mobile.addEventListener('change',()=>{$('identity').hidden=mobile.matches;$('identity-toggle').setAttribute('aria-expanded',String(!mobile.matches));});
 session().catch(e=>status(e.message));
