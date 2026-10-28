const form=document.querySelector('#login'),error=document.querySelector('#error'),button=form.querySelector('button');
const home=(globalThis.BOOKING_BASE_PATH||'')+(location.pathname.startsWith('/book/')?'/book/admin/':'/admin/');
fetch((globalThis.BOOKING_API_ORIGIN||'')+'/api/booking/admin/session',{credentials:'include'}).then(r=>r.json()).then(s=>{if(s.authenticated)location.replace(home);else if(s.configured===false){form.hidden=true;document.querySelector('#setup').hidden=false;}}).catch(()=>{error.textContent='Unable to connect. Reload to try again.';});
form.onsubmit=async e=>{e.preventDefault();button.disabled=true;error.textContent='';try{const r=await fetch((globalThis.BOOKING_API_ORIGIN||'')+'/api/booking/admin/login',{credentials:'include',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:form.password.value})});const d=await r.json();if(!r.ok)throw Error(d.error);form.reset();location.replace(home);}catch(err){error.textContent=err.message;button.disabled=false;}};

if(new URLSearchParams(location.search).get('password')==='changed')document.querySelector('#message').textContent='Password changed. Sign in with your new password.';

if(globalThis.BOOKING_API_ORIGIN&&location.hostname==='sohamb117.github.io'){form.hidden=true;error.textContent='Admin sign-in is available at calendar.morisoba.moe after the custom domain is configured.';}
