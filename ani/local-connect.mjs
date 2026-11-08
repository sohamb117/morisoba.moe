import {readFile,writeFile,rename} from 'node:fs/promises';
const page=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/shared/chrome.css"><link rel="stylesheet" href="/shared/typography.css"><link rel="stylesheet" href="/style.css"><title>Connect TorBox</title></head><body><main style="max-width:420px;margin:15vh auto"><h2>Connect TorBox</h2><form id="connect" style="display:grid;gap:16px"><label for="key">API key</label><input id="key" type="password" autocomplete="off" required><button>Connect</button><p id="status" role="status"></p></form></main><script>document.getElementById('connect').onsubmit=async e=>{e.preventDefault();const key=document.getElementById('key'),button=e.target.querySelector('button'),status=document.getElementById('status');button.disabled=true;status.textContent='Connecting…';try{const response=await fetch('/api/local/torbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:key.value})});key.value='';const result=await response.json();if(!response.ok)throw Error(result.error);status.textContent='Connected. Your key is saved privately.';button.hidden=true;key.hidden=true;e.target.querySelector('label').hidden=true;}catch(error){key.value='';status.textContent=error.message;}finally{button.disabled=false;}};</script></body></html>`;
export async function localConnect(request,authorized){
  const url=new URL(request.url);const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  if(request.method==='GET'&&url.pathname==='/connect-torbox')return new Response(page,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"}});
  if(url.pathname!=='/api/local/torbox')return null;
  const json=(x,status=200)=>Response.json(x,{status,headers});
  if(request.method!=='POST'||!authorized||request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Reload the connection page and try again.'},403);
  try{const {key}=await request.json();if(typeof key!=='string'||key.trim().length<10||key.length>2048)return json({error:'Enter a valid API key.'},400);
    const token=key.trim();const response=await fetch('https://api.torbox.app/v1/api/user/me',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=await response.json();if(!response.ok||data.success!==true)return json({error:'TorBox did not accept this key.'},400);
    const file=new URL('./.dev.vars',import.meta.url),temporary=new URL('./.dev.vars.new',import.meta.url);
    const previous=await readFile(file,'utf8').catch(()=> '');const lines=previous.split('\n').filter(line=>!line.startsWith('TORBOX_TOKEN=')&&line.trim());
    lines.push('TORBOX_TOKEN='+JSON.stringify(token));await writeFile(temporary,lines.join('\n')+'\n',{mode:0o600});await rename(temporary,file);process.env.TORBOX_TOKEN=token;
    return json({connected:true});
  }catch{return json({error:'Could not connect. Please try again.'},502);}
}
