import {SignJWT,importPKCS8} from 'jose';
import {controlSession} from './control-auth.mjs';
import {seal,unseal} from './connection-crypto.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>Object.assign(Error(message),{status});
async function read(response,max=2000000){const reader=response.body?.getReader();if(!reader)throw fail('Empty response');let bytes=0,text='';const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>max)throw fail('Response too large',413);text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
export async function slackCall(token,method,params={},write=false){
 const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined));
 let response;try{response=await fetch('https://slack.com/api/'+method+(write?'':'?'+query),{method:write?'POST':'GET',headers:{Authorization:'Bearer '+token,...(write?{'Content-Type':'application/json; charset=utf-8'}:{})},...(write?{body:JSON.stringify(params)}:{}),redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{throw fail(write?'Send result unknown. Check Slack before retrying.':'Slack unavailable',502);}
 if(response.status===429)throw fail('Slack rate limit. Try again in '+(response.headers.get('Retry-After')||'60')+' seconds.',429);
 if(!response.ok)throw fail('Slack request failed',502);const data=await read(response);if(!data.ok)throw fail(data.error==='missing_scope'?'Slack token needs '+(data.needed||'additional scopes'):['invalid_auth','token_revoked','token_expired','not_authed'].includes(data.error)?'Reconnect Slack':data.error==='not_in_channel'?'Join this channel in Slack first':'Slack: '+data.error,409);return data;
}
const slackId=id=>/^[CDGUW][A-Z0-9]{8,24}$/.test(id||'');
const slackMessage=m=>({id:m.ts,text:m.text||'',author:m.user||m.bot_id||'Slack',createdAt:new Date(Number(m.ts)*1000).toISOString(),thread:m.thread_ts||m.ts,replies:m.reply_count||0,files:(m.files||[]).map(f=>({name:f.name||'Attachment',url:f.permalink}))});
export async function slackWorkspaces(env){
 const {results}=await env.MIMORI_DB.prepare("SELECT provider,encrypted_token,account FROM control_app_connections WHERE provider='slack' OR provider LIKE 'slack:%' ORDER BY provider").all();
 const rows=new Map();for(const row of results){const auth=JSON.parse(await unseal(row.encrypted_token,env));rows.set(auth.team,{id:auth.team,name:auth.name||row.account.split(' / ')[0],account:row.account,provider:row.provider,auth});}return [...rows.values()];
}
async function bridge(env,provider,route,auth,args={}){
 if(!env.SOCIAL_BRIDGE_CREDENTIALS||!env.SOCIAL_BRIDGE_URL)throw fail('Social connection service is not configured',503);
 let stage='service identity';
 try{
 const credential=JSON.parse(env.SOCIAL_BRIDGE_CREDENTIALS),audience=env.SOCIAL_BRIDGE_URL;
 const key=await importPKCS8(credential.private_key,'RS256');
 const assertion=await new SignJWT({target_audience:audience}).setProtectedHeader({alg:'RS256',typ:'JWT'}).setIssuer(credential.client_email).setSubject(credential.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('5m').sign(key);
 stage='identity exchange';
 const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),redirect:'manual',signal:AbortSignal.timeout(10000)});
 if(!tokenResponse.ok)throw fail('Social service authentication failed',503);
 const identity=await read(tokenResponse,20000);
 stage='adapter request';
 const response=await fetch(audience+'/request',{method:'POST',headers:{Authorization:'Bearer '+identity.id_token,'Content-Type':'application/json'},body:JSON.stringify({provider,route,auth,args}),redirect:'manual',signal:AbortSignal.timeout(55000)});
 stage='adapter response (HTTP '+response.status+')';
 const data=await read(response);if(!response.ok||data.error)throw fail(data.error||'Social request failed',502);return data;
 }catch(e){if(e.status)throw e;console.warn(JSON.stringify({event:'social_bridge_error',provider,route,stage,errorType:e.name}));throw fail('Social connection failed at '+stage+' ('+(e.name==='TimeoutError'?'timeout':'transport error')+').',502);}
}
export async function socialApi(request,env){
 const url=new URL(request.url),[,provider,route]=url.pathname.match(/^\/api\/control\/(slack|x|instagram)\/([a-z-]+)$/)||[];const session=await controlSession(request,env);
 if(!session)return json({error:'Sign in required'},401);if(request.method!=='GET'&&(request.headers.get('Origin')!==url.origin||request.headers.get('X-CSRF-Token')!==session.csrf||request.headers.get('Sec-Fetch-Site')==='cross-site'))return json({error:'Session check failed'},403);
 let operation='request body';
 try{
  const db=env.MIMORI_DB;let input;if(request.method==='POST')input=await read(request,50000);
  if(['x','instagram'].includes(provider)){
   if(route==='connection'&&request.method==='DELETE'){await db.prepare('DELETE FROM control_app_connections WHERE provider=?').bind(provider).run();return json({ok:true});}
   if(route==='connection'&&request.method==='POST'){
    const auth=provider==='x'?{auth_token:input.auth_token,ct0:input.ct0}:{sessionid:input.sessionid};
    for(const value of Object.values(auth))if(typeof value!=='string'||value.length<16||value.length>4096||/[\s\r\n]/.test(value))throw fail('Enter the session cookie values');
    operation='session verification';
    const data=await bridge(env,provider,route,auth);
    operation='session storage';
    await db.prepare('INSERT INTO control_app_connections VALUES(?,?,?,?) ON CONFLICT(provider) DO UPDATE SET encrypted_token=excluded.encrypted_token,account=excluded.account,updated_ms=excluded.updated_ms').bind(provider,await seal(JSON.stringify(data.auth),env),data.result.account,Date.now()).run();return json({connected:true});
   }
   if(!['feed','following','conversations','messages'].includes(route)||!['GET','POST'].includes(request.method)||request.method==='POST'&&route!=='messages')return json({error:'Not found'},404);
   const connection=await db.prepare('SELECT encrypted_token,updated_ms FROM control_app_connections WHERE provider=?').bind(provider).first();
   if(!connection)throw fail('Connect '+(provider==='x'?'X':'Instagram')+' in Connection Manager',409);
   const args={cursor:url.searchParams.get('cursor')||'',channel:url.searchParams.get('channel')||'',mode:url.searchParams.get('mode')||'',write:request.method==='POST',text:input?.text};
   if(args.cursor.length>2000)throw fail('Invalid cursor');
   if(route==='messages'&&!/^[0-9-]{1,80}$/.test(args.channel))throw fail('Select a conversation');
   if(args.write&&(typeof args.text!=='string'||!args.text.trim()||args.text.length>4000))throw fail('Enter a message of up to 4,000 characters');
   const data=await bridge(env,provider,route,JSON.parse(await unseal(connection.encrypted_token,env)),args);
   await db.prepare('UPDATE control_app_connections SET encrypted_token=?,updated_ms=? WHERE provider=? AND updated_ms=?').bind(await seal(JSON.stringify(data.auth),env),Date.now(),provider,connection.updated_ms).run();
   return json(data.result);
  }
  if(provider==='slack'){
   if(route==='connection'&&request.method==='POST'){
    if(typeof input.token!=='string'||!/^xoxp-[A-Za-z0-9-]{20,1000}$/.test(input.token))throw fail('Enter a Slack OAuth user token (xoxp).');const who=await slackCall(input.token,'auth.test');
    await db.prepare("INSERT INTO control_app_connections VALUES(?,?,?,?) ON CONFLICT(provider) DO UPDATE SET encrypted_token=excluded.encrypted_token,account=excluded.account,updated_ms=excluded.updated_ms").bind('slack:'+who.team_id,await seal(JSON.stringify({token:input.token,user:who.user_id,team:who.team_id,name:who.team}),env),who.team+' / '+who.user,Date.now()).run();return json({connected:true});
   }
   const workspaces=await slackWorkspaces(env);
   if(route==='workspaces'&&request.method==='GET')return json({items:workspaces.map(({id,name,account})=>({id,name,account}))});
   const team=url.searchParams.get('workspace'),workspace=team?workspaces.find(w=>w.id===team):workspaces[0];
   if(!workspace)throw fail('Connect this Slack workspace in Connection Manager',409);const auth=workspace.auth;
   if(route==='connection'&&request.method==='DELETE'){
    await db.prepare('DELETE FROM control_app_connections WHERE provider=?').bind(workspace.provider).run();
    const legacy=await db.prepare("SELECT encrypted_token FROM control_app_connections WHERE provider='slack'").first();
    if(legacy&&JSON.parse(await unseal(legacy.encrypted_token,env)).team===workspace.id)await db.prepare("DELETE FROM control_app_connections WHERE provider='slack'").run();return json({ok:true});
   }
   if(route==='activity'&&request.method==='GET'){const channel=url.searchParams.get('channel');if(!slackId(channel))throw fail('Select a conversation');const result=await slackCall(auth.token,'conversations.history',{channel,limit:1});return json({latest:result.messages?.[0]?.ts||'0'});}
   if(route==='conversations'&&request.method==='GET'){const result=await slackCall(auth.token,'users.conversations',{types:'public_channel,private_channel,im,mpim',exclude_archived:true,limit:100,cursor:url.searchParams.get('cursor')||undefined});return json({items:result.channels.map(c=>({id:c.id,name:c.name||c.user||c.id,direct:!!(c.is_im||c.is_mpim),user:c.user,latest:c.latest?.ts||null})),cursor:result.response_metadata?.next_cursor||''});}
   if(route==='users'&&request.method==='GET'){const result=await slackCall(auth.token,'users.list',{limit:200,cursor:url.searchParams.get('cursor')||undefined});return json({items:result.members.map(u=>({id:u.id,name:u.profile?.display_name||u.real_name||u.name})),cursor:result.response_metadata?.next_cursor||''});}
   if(route==='messages'){
    const channel=url.searchParams.get('channel');if(!slackId(channel))throw fail('Select a conversation');
    if(request.method==='GET'){const thread=url.searchParams.get('thread');if(thread&&!/^\d{10,20}\.\d{6}$/.test(thread))throw fail('Invalid thread');const result=await slackCall(auth.token,thread?'conversations.replies':'conversations.history',{channel,limit:15,cursor:url.searchParams.get('cursor')||undefined,...(thread?{ts:thread}:{})});return json({items:result.messages.map(slackMessage).sort((a,b)=>Number(a.id)-Number(b.id)),cursor:result.response_metadata?.next_cursor||''});}
    if(request.method==='POST'){if(typeof input.text!=='string'||!input.text.trim()||input.text.length>4000)throw fail('Enter a message of up to 4,000 characters');if(input.thread&&!/^\d{10,20}\.\d{6}$/.test(input.thread))throw fail('Invalid thread');if(!/^[a-f0-9-]{36}$/.test(input.nonce||''))throw fail('Invalid message identifier');const sent=await slackCall(auth.token,'chat.postMessage',{channel,text:input.text,client_msg_id:input.nonce,...(input.thread?{thread_ts:input.thread}:{})},true);return json({item:slackMessage(sent.message)},201);}
   }
  }
  return json({error:'Not found'},404);
 }catch(e){if(!e.status)console.warn(JSON.stringify({event:'social_api_error',provider,route,operation,errorType:e.name}));return json({error:e.status?e.message:'Social connection failed at '+operation+'.'},e.status||502);}
}
