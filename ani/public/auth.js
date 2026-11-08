const dialog=document.getElementById('login-dialog'),form=document.getElementById('login-form'),status=document.getElementById('login-status'),logout=document.getElementById('sign-out');
async function api(path,body,csrf){const r=await fetch('/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error||'Sign-in failed');return j;}
let config,session,owner=false;
async function signIn(){if(!dialog.open)dialog.showModal();config=await api('control/config');}
function signedIn(s,isOwner){session=s;owner=isOwner;logout.hidden=!!s.local;dialog.close();window.dispatchEvent(new Event('ani-signed-in'));}
window.addEventListener('ani-sign-in',()=>signIn().catch(()=>{status.textContent='Sign-in unavailable. Try again shortly.';}));
(async()=>{try{const s=await api('control/session');if(s.authenticated){signedIn(s,true);return;}const member=await api('ani/session');if(member.authenticated){signedIn(member,false);return;}await signIn();}catch{await signIn().catch(()=>{status.textContent='Sign-in unavailable. Try again shortly.';});}})();
form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;status.textContent='';try{
 config ||= await api('control/config');
 const username=form.elements.username.value.trim().toLowerCase(),password=form.elements.password.value;form.elements.password.value='';
 if(username!==config.username.toLowerCase()){signedIn(await api('ani/login',{username,password}),false);return;}
 const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:config.email,password,returnSecureToken:true})});
 const result=await r.json();if(!r.ok)throw new Error('Username or password is incorrect.');
 await api('control/login',{idToken:result.idToken});signedIn(await api('control/session'),true);
}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
logout.onclick=async()=>{logout.disabled=true;try{await api(owner?'control/logout':'ani/logout',{},session.csrf);location.reload();}catch(e){logout.disabled=false;status.textContent=e.message;}};
