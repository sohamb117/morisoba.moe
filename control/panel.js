// Open the account controls when launched by the administrative desktop.
if(new URLSearchParams(location.search).get('panel')==='1'&&location.hash==='#account'){
 const account=document.querySelector('#account');if(account)account.open=true;
}
