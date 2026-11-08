export function createAniAccounts({api}){
 const root=document.getElementById('ani-accounts-root');
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 async function open(){
  root.replaceChildren();const form=node('form');form.className='ani-account-create';
  form.innerHTML='<label>Username<input name="username" autocomplete="off" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}" minlength="3" maxlength="32" required></label><label>Password<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><button>Create account</button>';
  const status=node('p');status.setAttribute('role','status');const list=node('div');list.className='ani-account-list';root.append(node('p','Access to the anime player.'),form,status,list);
  form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;const data=Object.fromEntries(new FormData(form));form.elements.password.value='';try{await api(data);await open();}catch(err){status.textContent=err.message;}finally{b.disabled=false;}};
  try{const {accounts}=await api();if(!accounts.length)list.append(node('p','No accounts yet.'));
   for(const account of accounts){const row=node('section');row.className='app-section';const line=node('div');line.className='actions';line.append(node('strong',account.username),node('span',account.disabled?'Disabled':'Active'));
    const toggle=node('button',account.disabled?'Enable':'Disable');toggle.onclick=async()=>{toggle.disabled=true;try{await api({id:account.id,disabled:!account.disabled},'PATCH');await open();}catch(e){status.textContent=e.message;toggle.disabled=false;}};line.append(toggle);row.append(line);
    const details=node('details'),summary=node('summary','Reset password'),reset=node('form');reset.innerHTML='<label>New password<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><button>Reset password</button>';const result=node('p');result.setAttribute('role','status');reset.append(result);
    reset.onsubmit=async e=>{e.preventDefault();const b=reset.querySelector('button');b.disabled=true;const password=reset.elements.password.value;reset.reset();try{await api({id:account.id,password},'PATCH');result.textContent='Password reset. Existing sessions signed out.';}catch(e){result.textContent=e.message;}finally{b.disabled=false;}};
    details.append(summary,reset);row.append(details);list.append(row);
   }
  }catch(err){status.textContent=err.message;}
 }
 return {open};
}
