const $ = id => document.getElementById(id);
const API = '/api/mimorigasaka';
const mobile = matchMedia('(max-width:650px)');
const state = {user:null, csrf:null, panelOpen:false, filter:'all', next:null, loading:false, generation:0, posts:new Map(), editing:null, authEpoch:0};
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('mimorigasaka-auth') : null;
// Invitation credentials live in the fragment, never in HTTP request URLs or referrers.
let invitation = new URLSearchParams(location.hash.slice(1)).get('invite');
if (invitation) history.replaceState(null, '', location.pathname);
function status(id, message = '', error = false) { $(id).textContent = message; $(id).classList.toggle('error', error); }
function node(tag, className, content) { const el = document.createElement(tag); if(className) el.className = className; if(content !== undefined) el.textContent = content; return el; }
async function api(path, {method='GET', data, raw, type} = {}) {
  const epoch = state.authEpoch;
  const headers = {};
  if (method !== 'GET') {
    headers['Content-Type'] = type || 'application/json';
    if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
  }
  const response = await fetch(API + path, {method, headers, body:raw || (data === undefined ? undefined : JSON.stringify(data)), credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(20000)});
  const result = await response.json();
  if(epoch!==state.authEpoch&&!['/login','/register','/session'].includes(path))throw new Error('Account changed. Try again.');
  if (!response.ok) {
    if (response.status === 401 && !['/login','/register'].includes(path)) clearSession('Session expired. Sign in again.');
    throw new Error(result.error || 'Request failed.');
  }
  return result;
}
async function busy(button, action, errorTarget) {
  button.disabled = true;
  try { await action(); } catch (error) { status(errorTarget, error.name === 'TimeoutError' ? 'Request timed out. Try again.' : error.message, true); }
  finally { button.disabled = false; }
}
function avatar(img, author) {
  img.onerror = () => { img.onerror = null; img.src = '/shared/morisoba-lily.svg'; };
  img.src = author.avatarVersion ? `${API}/avatars/${author.id}?v=${author.avatarVersion}` : '/shared/morisoba-lily.svg';
}
function render() {
  const signedIn = !!state.user;
  $('identity').hidden = mobile.matches && !state.panelOpen;
  $('identity').classList.toggle('signed-in', signedIn);
  $('identity-toggle').textContent = signedIn ? `C:${state.user.username}>` : 'login';
  $('identity-toggle').setAttribute('aria-expanded', String(!$('identity').hidden));
  $('identity-title').textContent = signedIn ? state.user.displayName : 'LAYER:00 IDENTITY';
  $('profile').hidden = !signedIn;
  $('login-form').hidden = signedIn;
  $('lock').hidden = signedIn;
  $('feed').hidden = !signedIn;
  $('invite-notice').hidden = !invitation;
  $('password-hint').hidden = !invitation;
  $('login-password').autocomplete = invitation ? 'new-password' : 'current-password';
  $('login-submit').textContent = invitation ? 'JOIN' : 'ENTER';
  if (signedIn) {
    $('profile-handle').textContent = '@' + state.user.username;
    $('profile-bio').textContent = state.user.bio;
    avatar($('profile-picture'), state.user);
    $('admin-tools').hidden = state.user.role !== 'admin';
  }
}
function clearSession(message = '') {
  state.authEpoch++; state.user = null; state.csrf = null; state.posts.clear(); state.next = null; state.editing = null; state.generation++;
  $('posts').replaceChildren(); $('draft').value = ''; $('profile-bio').textContent = ''; $('profile-picture').src='/shared/morisoba-lily.svg';
  $('profile-settings').reset(); $('profile-settings').hidden=true; $('edit-profile').setAttribute('aria-expanded','false');
  $('password-form').reset(); $('invites').replaceChildren(); $('members').replaceChildren(); $('invite-link').value=''; $('new-invite').hidden=true;
  $('cancel-edit').hidden=true; $('composer-heading').textContent='New post'; $('publish').textContent='Post'; $('count').textContent='0 / 2000';
  $('load-more').hidden = true;
  for (const id of ['feed-status','profile-status','post-status','admin-status','password-status']) status(id);
  status('login-status',message); render();
}
function focusIdentity(forceOpen = false) {
  state.panelOpen = forceOpen || !mobile.matches || !state.panelOpen;
  render();
  if (!$('identity').hidden) (state.user ? $('draft') : $('login-id')).focus({preventScroll:!mobile.matches});
}
$('identity-toggle').addEventListener('click',()=>focusIdentity());
$('unlock').addEventListener('click',()=>focusIdentity(true));
mobile.addEventListener('change',render);
$('login-form').addEventListener('submit',event=>{
  event.preventDefault(); status('login-status');
  busy($('login-submit'),async()=>{
    const result = await api(invitation ? '/register' : '/login', {method:'POST',data:{username:$('login-id').value.trim(),password:$('login-password').value,...(invitation ? {invite:invitation} : {})}});
    clearSession(); state.user=result.user; state.csrf=result.csrf; state.panelOpen=false; invitation=null;
    $('login-form').reset(); render(); channel?.postMessage('changed'); await loadPosts();
  },'login-status');
});
$('logout').addEventListener('click',()=>busy($('logout'),async()=>{
  await api('/logout',{method:'POST',data:{}}); clearSession(); channel?.postMessage('changed');
},'password-status'));
function postBody(text) {
  const p = node('p','post-body');
  for (const part of text.split(/(https?:\/\/[^\s<>]+)/g)) {
    if (/^https?:\/\//.test(part)) {
      try { const url = new URL(part); if (!['https:','http:'].includes(url.protocol)) throw new Error();
        const a = node('a','',part); a.href = url.href; a.target='_blank'; a.rel='noopener noreferrer'; p.append(a);
      } catch { p.append(document.createTextNode(part)); }
    } else p.append(document.createTextNode(part));
  }
  return p;
}
function action(label, fn) { const b=node('button','',label); b.type='button'; b.addEventListener('click',()=>busy(b,fn,'feed-status')); return b; }
function drawPost(post) {
  const article=node('article','post' + (post.pinned ? ' pinned' : '')); article.id='post-'+post.id;
  const img=node('img','post-avatar');img.alt='';img.width=20;img.height=20;avatar(img,post.author);
  const meta=node('div','post-meta'); meta.append(node('span','author',post.author.displayName),node('span','', '@'+post.author.username));
  const time=node('time','',new Date(post.createdAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}));time.dateTime=new Date(post.createdAt).toISOString();meta.append(time);
  if(post.pinned)meta.append(node('span','','Pinned'));
  if(post.updatedAt!==post.createdAt)meta.append(node('span','','Edited'));
  const actions=node('div','post-actions');
  const link=node('a','','Link');link.href='#post-'+post.id;actions.append(link);
  if(post.canEdit){
    actions.append(action('Edit',async()=>{state.editing=post.id;$('draft').value=post.body;$('count').textContent=post.body.length+' / 2000';$('composer-heading').textContent='Edit post';$('publish').textContent='Save';$('cancel-edit').hidden=false;focusIdentity(true);}));
    actions.append(action(post.pinned?'Unpin':'Pin',async()=>{await api('/posts/'+post.id,{method:'PATCH',data:{pinned:!post.pinned}});await loadPosts();}));
  }
  if(post.canEdit||post.canModerate)actions.append(action('Delete',async()=>{
    const dialog=$('delete-dialog');dialog.returnValue='cancel';dialog.showModal();
    const result=await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true}));
    if(result==='delete'){await api('/posts/'+post.id,{method:'DELETE',data:{}});if(state.editing===post.id)cancelEdit();await loadPosts();}
  }));
  article.append(img,meta,postBody(post.body),actions);return article;
}
async function loadPosts(append=false) {
  if(!state.user)return;
  const generation=++state.generation;state.loading=true;$('load-more').disabled=true;
  status('feed-status',append?'Loading…':'');
  const params=new URLSearchParams();if(append&&state.next)params.set('before',state.next);
  if(state.filter==='pinned')params.set('pinned','1');if(state.filter==='mine')params.set('author',state.user.username);
  try {
    const data=await api('/posts?'+params);
    if(generation!==state.generation||!state.user)return;
    if(!append){$('posts').replaceChildren();state.posts.clear();}
    for(const post of data.posts){if(state.posts.has(post.id))continue;state.posts.set(post.id,post);$('posts').append(drawPost(post));}
    state.next=data.next;$('load-more').hidden=!data.next;
    status('feed-status',state.posts.size?'':'No posts yet.');
  } catch(error){if(generation===state.generation)status('feed-status',error.message,true);}
  finally {if(generation===state.generation){state.loading=false;$('load-more').disabled=false;}}
}
async function showLinkedPost(){
  const match=/^#post-([1-9][0-9]*)$/.exec(location.hash);if(!match||!state.user)return;
  const id=Number(match[1]);
  try {if(!state.posts.has(id)){const {post}=await api('/posts/'+id);if(!state.user)return;state.posts.set(id,post);$('posts').prepend(drawPost(post));} $('post-'+id)?.scrollIntoView({block:'center'});}
  catch(error){status('feed-status',error.message,true);}
}
window.addEventListener('hashchange',()=>{
  const nextInvite=new URLSearchParams(location.hash.slice(1)).get('invite');
  if(nextInvite){invitation=nextInvite;history.replaceState(null,'',location.pathname);state.panelOpen=true;render();if(state.user)status('page-status','Sign out to use this invitation.');}
  else showLinkedPost();
});
$('refresh').addEventListener('click',()=>loadPosts());
$('load-more').addEventListener('click',()=>loadPosts(true));
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{state.filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));loadPosts();}));
$('draft').addEventListener('input',()=>{$('count').textContent=$('draft').value.length+' / 2000';});
function cancelEdit(){state.editing=null;$('draft').value='';$('count').textContent='0 / 2000';$('composer-heading').textContent='New post';$('publish').textContent='Post';$('cancel-edit').hidden=true;status('post-status');}
$('cancel-edit').addEventListener('click',cancelEdit);
$('post-form').addEventListener('submit',event=>{event.preventDefault();busy($('publish'),async()=>{
  status('post-status');const body=$('draft').value.trim();if(!body)throw new Error('Write a post first.');
  await api(state.editing?'/posts/'+state.editing:'/posts',{method:state.editing?'PATCH':'POST',data:{body}});
  cancelEdit();status('post-status','Saved.');await loadPosts();
},'post-status');});
$('edit-profile').addEventListener('click',()=>{
  const open=$('profile-settings').hidden;$('profile-settings').hidden=!open;$('edit-profile').setAttribute('aria-expanded',String(open));
  if(open){$('display-name').value=state.user.displayName;$('bio').value=state.user.bio;status('profile-status');}
});
$('cancel-profile').addEventListener('click',()=>{$('profile-settings').hidden=true;$('profile-settings').reset();$('edit-profile').setAttribute('aria-expanded','false');});
async function pictureBlob(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5000000)throw new Error('Choose a PNG, JPEG, or WebP under 5 MB.');
  const bitmap=await createImageBitmap(file);
  try {
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    const context=canvas.getContext('2d'),size=Math.min(bitmap.width,bitmap.height);
    context.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.85));
    if(!blob||blob.size>256000)throw new Error('Picture is too large.');return blob;
  } finally {bitmap.close();}
}
$('profile-settings').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,async()=>{
  const file=$('picture').files[0];const blob=file?await pictureBlob(file):null;
  const data=await api('/profile',{method:'PATCH',data:{displayName:$('display-name').value,bio:$('bio').value}});state.user=data.user;
  if(blob)state.user=(await api('/avatar',{method:'PUT',raw:blob,type:blob.type})).user;
  $('profile-settings').reset();$('profile-settings').hidden=true;$('edit-profile').setAttribute('aria-expanded','false');render();await loadPosts();
},'profile-status');});
$('remove-picture').addEventListener('click',()=>busy($('remove-picture'),async()=>{state.user=(await api('/avatar',{method:'DELETE',data:{}})).user;$('picture').value='';render();await loadPosts();},'profile-status'));
$('password-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,async()=>{
  const data=await api('/password',{method:'POST',data:{currentPassword:$('current-password').value,password:$('new-password').value}});
  state.user=data.user;state.csrf=data.csrf;$('password-form').reset();status('password-status','Passcode changed. Other sessions signed out.');channel?.postMessage('changed');
},'password-status');});
async function loadAdmin(){
  if(state.user?.role!=='admin')return;
  try {
    const [invites,members]=await Promise.all([api('/invites'),api('/members')]);
    if(state.user?.role!=='admin')return;
    $('invites').replaceChildren();$('members').replaceChildren();
    for(const invite of invites.invites){
      const used=invite.claimedBy||invite.revoked||invite.expiresAt<Date.now();
      const row=node('div','admin-row',invite.claimedBy?'Used invitation':invite.revoked?'Revoked invitation':invite.expiresAt<Date.now()?'Expired invitation':'Expires '+new Date(invite.expiresAt).toLocaleDateString());
      if(!used){const b=node('button','','Revoke');b.type='button';b.addEventListener('click',()=>busy(b,async()=>{await api('/invites/'+invite.id,{method:'DELETE',data:{}});await loadAdmin();},'admin-status'));row.append(b);}$('invites').append(row);
    }
    for(const member of members.members){
      const row=node('div','admin-row','@'+member.username+(member.disabled?' · disabled':''));
      if(member.role!=='admin'){const b=node('button','',member.disabled?'Enable':'Disable');b.type='button';b.addEventListener('click',()=>busy(b,async()=>{await api('/members/'+member.id,{method:'PATCH',data:{disabled:!member.disabled}});await loadAdmin();await loadPosts();},'admin-status'));row.append(b);}$('members').append(row);
    }
  }catch(error){status('admin-status',error.message,true);}
}
$('admin-tools').addEventListener('toggle',()=>{if($('admin-tools').open)loadAdmin();});
$('create-invite').addEventListener('click',()=>busy($('create-invite'),async()=>{
  const data=await api('/invites',{method:'POST',data:{}});
  $('invite-link').value=location.origin+location.pathname+'#invite='+data.token;$('new-invite').hidden=false;status('admin-status','Copy this link now. It is shown only once.');await loadAdmin();
},'admin-status'));
$('copy-invite').addEventListener('click',()=>busy($('copy-invite'),async()=>{try{await navigator.clipboard.writeText($('invite-link').value);status('admin-status','Copied.');}catch{$('invite-link').select();status('admin-status','Select and copy the link.');}},'admin-status'));
async function restoreSession(){
  const epoch=state.authEpoch;
  try {
    const data=await api('/session');
    if(epoch!==state.authEpoch)return;
    status('page-status');
    if(!data.user){clearSession();return;}
    if(state.user?.id!==data.user.id)clearSession();
    state.user=data.user;state.csrf=data.csrf;render();await loadPosts();await showLinkedPost();
  }catch(error){if(epoch!==state.authEpoch)return;clearSession();status('page-status',error.message,true);}
}
channel?.addEventListener('message',()=>{clearSession();restoreSession();});
// Revalidate on returning to a tab; never keep displaying data after discovering a revoked session.
window.addEventListener('pageshow',event=>{if(event.persisted){clearSession();restoreSession();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')restoreSession();});
if(invitation)state.panelOpen=true;
render();restoreSession();
