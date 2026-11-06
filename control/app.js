import {initCalendar} from './calendar.js';
import {initCommunity} from './community.js';
import {initKeyring} from './keyring.js';
const $=s=>document.querySelector(s);
let csrf='',owner,started=false,closeKeyring=()=>{};
async function api(path,data,method='POST'){
 const response=await fetch(path,{method:data===undefined?'GET':method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const result=await response.json();if(response.status===401){lock();throw Error('Sign in required');}if(!response.ok)throw Error(result.error||'Request failed');return result;
}
function lock(){closeKeyring();$('#stage').hidden=true;$('#dock').hidden=true;$('#entry-gate').hidden=false;csrf='';}
const layout=[['p-name',.035,.055],['p-note',.300,.055],['p-ascii',.640,.060],['p-oracle',.515,.055],['p-about',.030,.500],['p-works',.260,.400],['p-contact',.590,.450],['p-console',.715,.620],['p-vessel',.680,.300],['p-litany',.295,.800]];
const wires=[['p-name','right','p-works','left'],['p-name','bottom','p-about','top'],['p-about','right','p-contact','left'],['p-works','right','p-oracle','left'],['p-oracle','top','p-ascii','bottom'],['p-note','right','p-ascii','left'],['p-note','bottom','p-works','top'],['p-console','left','p-contact','right'],['p-vessel','left','p-ascii','bottom']];
const floors=[['p-about',.4],['p-works',.6],['p-contact',.5],['p-console',.6]];
const drops=[[.05,'p-name'],[.22,'p-name'],[.44,'p-note'],[.55,'p-oracle'],[.72,'p-ascii'],[.80,'p-console']];
let panels;
function openPanel(id){const p=panels[id];if(!p)return;const title=p.querySelector('.tl').textContent;[...$('#dock').children].find(b=>b.textContent===title)?.click();p.classList.remove('min');bringTop(p);if(isMobile())p.scrollIntoView({behavior:'smooth',block:'start'});drawWires();}
function closePanel(id){const p=panels[id];if(p.style.display!=='none')p.querySelector('[data-act=close]').click();}
function arrange(){for(const [id,x,y] of layout){const p=panels[id];p.classList.remove('is-maximized');if(!isMobile()){p.style.width=p.dataset.w+'px';p.style.left=Math.min(x*innerWidth,Math.max(8,innerWidth-Number(p.dataset.w)-12))+'px';p.style.top=y*innerHeight+'px';}}drawTraces();drawWires(null,wires,floors,drops);}
async function start(s){
 owner=s.user;csrf=s.csrf;$('#entry-gate').hidden=true;$('#stage').hidden=false;$('#dock').hidden=false;$('#owner-email').textContent=owner.email;$('#profile-form').elements.displayName.value=owner.displayName;$('#profile-form').elements.bio.value=owner.bio||'';
 if(started){location.reload();return;}started=true;
 panels=applyPanelLayout(layout,{});attachAccessories(Object.values(panels));spawnDecor({CODE:['']});drawTraces();
 for(const p of Object.values(panels)){p.classList.add('booted');const bar=p.querySelector('.titlebar'),button=document.createElement('button');button.className='expand';button.textContent='□';button.setAttribute('aria-label','Maximize '+p.querySelector('.tl').textContent);button.setAttribute('aria-pressed','false');button.onpointerdown=e=>e.stopPropagation();button.onclick=()=>{p.classList.toggle('is-maximized');p.classList.remove('min');button.setAttribute('aria-pressed',String(p.classList.contains('is-maximized')));bringTop(p);drawWires();};bar.insertBefore(button,bar.querySelector('.pbtn'));bar.ondblclick=e=>{if(!e.target.closest('button'))button.click();};}
 closePanel('p-vessel');closePanel('p-console');closePanel('p-litany');arrange();$('#arrange').onclick=arrange;addEventListener('resize',arrange);
 initCalendar({api:(path,data,method)=>api('/api/booking/admin/'+path,data,method),openPanel,closePanel});
 initCommunity({api:(path,data,method)=>api('/api/mimorigasaka/'+path,data,method)});
 closeKeyring=initKeyring({csrf,owner});
}
$('#login-form').onsubmit=async e=>{
 e.preventDefault();const form=e.target,button=$('#sign-in');button.disabled=true;$('#auth-error').textContent='';
 try{
  const config=await api('/api/control/config');
  const entered=form.elements.user.value.trim();const email=entered===config.username?config.email:entered;
  const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:form.elements.password.value,returnSecureToken:true})});
  const result=await response.json();if(!response.ok)throw Error('User or password is incorrect.');
  await api('/api/control/login',{idToken:result.idToken});form.reset();await start(await api('/api/control/session'));
 }catch(err){$('#auth-error').textContent=err.message;}finally{form.elements.password.value='';button.disabled=false;}
};
$('#sign-out').onclick=async()=>{try{await api('/api/control/logout',{});location.reload();}catch(e){$('#profile-status').textContent=e.message;}};
$('#profile-form').onsubmit=async e=>{e.preventDefault();try{await api('/api/mimorigasaka/profile',Object.fromEntries(new FormData(e.target)),'PATCH');$('#profile-status').textContent='Saved.';}catch(err){$('#profile-status').textContent=err.message;}};
try{const s=await api('/api/control/session');if(s.authenticated)await start(s);}catch(e){$('#auth-error').textContent=e.message;}

$('#password-form').onsubmit=async e=>{
 e.preventDefault();const f=e.target,b=f.querySelector('button');$('#password-status').textContent='';if(f.elements.next.value!==f.elements.confirm.value){$('#password-status').textContent='Passwords do not match.';return;}b.disabled=true;
 try{const config=await api('/api/control/config');const call=async(action,data)=>{const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:'+action+'?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(action==='signInWithPassword'?'Current password is incorrect.':'Password change failed.');return d;};const signed=await call('signInWithPassword',{email:owner.email,password:f.elements.current.value,returnSecureToken:true});await call('update',{idToken:signed.idToken,password:f.elements.next.value,returnSecureToken:true});f.reset();await api('/api/control/logout-all',{});location.reload();}catch(err){$('#password-status').textContent=err.message;}finally{b.disabled=false;f.elements.current.value='';}
};
