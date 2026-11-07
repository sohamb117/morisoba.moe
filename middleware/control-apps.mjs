import {gitActivity} from './control-git-activity.mjs';
import {controlSession} from './control-auth.mjs';
import {seal,unseal} from './connection-crypto.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function bounded(response,max){const reader=response.body?.getReader();if(!reader)return '';let size=0,result='';const decoder=new TextDecoder();try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Response is too large');}result+=decoder.decode(value,{stream:true});}return result+decoder.decode();}finally{reader.releaseLock();}}
async function github(token,path){const r=await fetch('https://api.github.com'+path,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'morisoba-control'},signal:AbortSignal.timeout(15000),redirect:'manual'});if(!r.ok)throw Error(r.status===401?'Reconnect GitHub':r.status===403?'GitHub access denied or rate limited':r.status===404?'Repository unavailable to this token':'GitHub request failed');return JSON.parse(await bounded(r,3000000));}
const publicV4=ip=>{const p=ip.split('.').map(Number);return p.length===4&&p.every(n=>Number.isInteger(n)&&n>=0&&n<256)&&![0,10,127].includes(p[0])&&p[0]<224&&!(p[0]===169&&p[1]===254)&&!(p[0]===172&&p[1]>=16&&p[1]<=31)&&!(p[0]===192&&[0,168].includes(p[1]))&&!(p[0]===100&&p[1]>=64&&p[1]<=127)&&!(p[0]===198&&[18,19].includes(p[1]));};
export function feedUrl(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!u.hostname.includes('.')||!/[a-z]/i.test(u.hostname)||u.hostname.includes(':')||/(?:^|\.)(localhost|local|internal|test|invalid|example)$/.test(u.hostname))throw Error('Use a public HTTPS feed URL');u.hash='';return u;}
async function publicHost(host){
 const results=await Promise.all(['A','AAAA'].map(async type=>{const r=await fetch('https://cloudflare-dns.com/dns-query?'+new URLSearchParams({name:host,type}),{headers:{Accept:'application/dns-json'},signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Cannot resolve feed host');return JSON.parse(await bounded(r,64000));}));
 const addresses=results.flatMap(r=>(r.Answer||[]).filter(a=>[1,28].includes(a.type)));if(!addresses.length||addresses.some(a=>a.type===1?!publicV4(a.data):!/^2[0-9a-f]{3}:/i.test(a.data)))throw Error('Feed host must use public addresses');
}
async function fetchFeed(raw){let u=feedUrl(raw);for(let i=0;i<5;i++){await publicHost(u.hostname);const r=await fetch(u.href,{redirect:'manual',headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml','User-Agent':'morisoba-feed-reader'},signal:AbortSignal.timeout(12000)});if([301,302,303,307,308].includes(r.status)){await r.body?.cancel();u=feedUrl(new URL(r.headers.get('Location'),u).href);continue;}if(!r.ok)throw Error('Feed returned HTTP '+r.status);const xml=await bounded(r,2000000);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unsupported feed declarations');return {xml,url:u.href};}throw Error('Too many feed redirects');}
export async function controlAppsApi(request,env){
 const url=new URL(request.url),route=url.pathname.slice('/api/control/'.length),method=request.method;
 const session=await controlSession(request,env);if(!session)return json({error:'Sign in required'},401);
 if(method!=='GET'&&(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.get('X-CSRF-Token')!==session.csrf))return json({error:'Session check failed'},403);
 try{
  let data;if(['POST','PATCH'].includes(method)){if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Use JSON'},415);data=JSON.parse(await bounded(request,12000));}
  const db=env.MIMORI_DB;
  if(route==='github/connection'){
   if(method==='GET'){const c=await db.prepare("SELECT account,updated_ms FROM control_app_connections WHERE provider='github'").first();return json({connected:!!c,...c});}
   if(method==='POST'){if(typeof data.token!=='string'||data.token.length<20||data.token.length>1000)throw Error('Enter a GitHub access token');const user=await github(data.token,'/user');await db.prepare("INSERT INTO control_app_connections VALUES('github',?,?,?) ON CONFLICT(provider) DO UPDATE SET encrypted_token=excluded.encrypted_token,account=excluded.account,updated_ms=excluded.updated_ms").bind(await seal(data.token,env),user.login,Date.now()).run();return json({connected:true,account:user.login});}
   if(method==='DELETE'){await db.prepare("DELETE FROM control_app_connections WHERE provider='github'").run();return json({ok:true});}
  }
  if(route.startsWith('github/')&&method==='GET'){
   const c=await db.prepare("SELECT encrypted_token FROM control_app_connections WHERE provider='github'").first();if(!c)return json({error:'Connect GitHub in Connection Manager'},409);const token=await unseal(c.encrypted_token,env),page=Math.min(100,Math.max(1,Number(url.searchParams.get('page'))||1));let path;
   if(route==='github/activity')return json(await gitActivity(token));
   if(route==='github/repos')path='/user/repos?sort=updated&per_page=50&page='+page;
   else if(['github/issues','github/pulls'].includes(route)){const repo=url.searchParams.get('repo');if(!/^[\w.-]+\/[\w.-]+$/.test(repo||''))throw Error('Select a repository');path='/repos/'+repo+'/'+route.split('/')[1]+'?state='+(url.searchParams.get('state')==='all'?'all':'open')+'&per_page=50&page='+page;}
   else return json({error:'Not found'},404);
   const rows=await github(token,path);return json({items:rows.filter(x=>route!=='github/issues'||!x.pull_request).map(x=>route==='github/repos'?{name:x.full_name,url:x.html_url,private:x.private,description:x.description}:{number:x.number,title:x.title,url:x.html_url,state:x.state,user:x.user?.login,updated:x.updated_at}),more:rows.length===50});
  }
  if(route==='rss/subscriptions'){
   if(method==='GET')return json({items:(await db.prepare('SELECT * FROM control_rss_subscriptions ORDER BY name COLLATE NOCASE').all()).results});
   if(['POST','PATCH'].includes(method)){const name=String(data.name||'').trim(),address=feedUrl(data.url).href;if(!name||name.length>120||address.length>2048)throw Error('Enter a name and feed URL');if(method==='POST'){const count=await db.prepare('SELECT COUNT(*) AS n FROM control_rss_subscriptions').first();if(count.n>=100)throw Error('Subscription limit reached');await db.prepare('INSERT INTO control_rss_subscriptions VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),name,address,data.enabled===false?0:1,Date.now()).run();}else await db.prepare('UPDATE control_rss_subscriptions SET name=?,url=?,enabled=? WHERE id=?').bind(name,address,data.enabled===false?0:1,String(data.id)).run();return json({ok:true});}
   if(method==='DELETE'){await db.prepare('DELETE FROM control_rss_subscriptions WHERE id=?').bind(url.searchParams.get('id')).run();return json({ok:true});}
  }
  if(route==='rss/feed'&&method==='GET'){const c=await db.prepare('SELECT url FROM control_rss_subscriptions WHERE id=? AND enabled=1').bind(url.searchParams.get('id')).first();if(!c)return json({error:'Select an enabled subscription'},404);return json(await fetchFeed(c.url));}
  return json({error:'Method not allowed'},405);
 }catch(e){return json({error:/UNIQUE constraint/.test(e.message)?'This feed is already subscribed':e.message?.startsWith('D1')?'Could not save changes':e.message||'Request failed'},400);}
}
