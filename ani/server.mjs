import {localConnect} from './local-connect.mjs';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {loadEnvFile} from 'node:process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setCacheStore} from './api/cache.mjs';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {handleAPI} from './api/router.mjs';
try{loadEnvFile(fileURLToPath(new URL('./.dev.vars',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
const session=randomBytes(32).toString('hex');
const authorize=request=>{const cookie=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('ani_session='))?.slice(12)||'';return cookie.length===session.length&&timingSafeEqual(Buffer.from(cookie),Buffer.from(session));};
const cacheDir=fileURLToPath(new URL('./.cache/',import.meta.url));await mkdir(cacheDir,{recursive:true});
const cachePath=key=>resolve(cacheDir,createHash('sha256').update(key).digest('hex')+'.json');
setCacheStore({get:key=>readFile(cachePath(key),'utf8').catch(()=>null),put:(key,value)=>writeFile(cachePath(key),value,{mode:0o600})});
const root=fileURLToPath(new URL('./public/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.ttf':'font/ttf','.woff2':'font/woff2','.svg':'image/svg+xml','.txt':'text/plain'};
const server=createServer(async(req,res)=>{
  try {
    const host=req.headers.host||'';
    if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)){res.writeHead(400);res.end();return;}
    const url=new URL(req.url,'http://'+host);
    let body;
    if(!['GET','HEAD'].includes(req.method)){const parts=[];let length=0;for await(const part of req){length+=part.length;if(length>10000){res.writeHead(413);res.end();return;}parts.push(part);}body=Buffer.concat(parts);}
    if(url.pathname==='/api/control/session'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({authenticated:true,local:true}));return;}
    const request=new Request(url,{method:req.method,headers:req.headers,...(body?{body}: {})});
    const local=await localConnect(request,authorize(request));
    if(local){if(url.pathname==='/connect-torbox'&&req.headers['sec-fetch-site']!=='cross-site')local.headers.set('Set-Cookie',`ani_session=${session}; HttpOnly; SameSite=Strict; Path=/`);res.writeHead(local.status,Object.fromEntries(local.headers));res.end(Buffer.from(await local.arrayBuffer()));return;}
    const result=await handleAPI(request,process.env,fetch,{authorize});
    if(result){res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403);res.end();return;}
    const assetBody=await readFile(path);
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...(url.pathname==='/'&&!req.headers['sec-fetch-site']?.includes('cross-site')?{'Set-Cookie':`ani_session=${session}; HttpOnly; SameSite=Strict; Path=/`}:{})});res.end(req.method==='HEAD'?undefined:assetBody);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT||8791),'127.0.0.1',()=>console.log('http://127.0.0.1:'+(process.env.PORT||8791)));
