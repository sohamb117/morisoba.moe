import {controlSession} from './control-auth.mjs';
import {google,configured} from './connections-google.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function connectionsApi(request,env,{authenticate=controlSession,call=google}={}){
 if(!await authenticate(request,env))return json({error:'Sign in required'},401);
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 try{
  const account={id:'google',name:'Google',account:env.CONTROL_OWNER_EMAIL,apps:['Calendar','Upcoming Events','Booking Manager'],events:false,calendarList:false};
  if(configured(env)){
   try{await call(env,'calendars/'+encodeURIComponent(env.BOOKING_CALENDAR_ID)+'/events?maxResults=1&timeMin='+encodeURIComponent(new Date().toISOString()),undefined,'GET');account.events=true;}catch{account.eventError='Event access needs reconnecting.';}
   try{await call(env,'users/me/calendarList?maxResults=1',undefined,'GET');account.calendarList=true;}catch{account.listError='Calendar-list access required.';}
  }
  const mimori=env.MIMORI_PROTOCOL_ENABLED==='true'&&!!env.MIMORI_PROTOCOL_DB;
  const gh=await env.MIMORI_DB.prepare("SELECT account FROM control_app_connections WHERE provider='github'").first();
  const rss=await env.MIMORI_DB.prepare('SELECT COUNT(*) AS n FROM control_rss_subscriptions').first();
  return json({connections:[{id:'github',name:'GitHub',account:gh?.account||'',connected:!!gh,apps:['GitHub']},{id:'spotify',name:'Spotify',account:'',connected:!!(env.SPOTIFY_CLIENT_ID&&env.SPOTIFY_CLIENT_SECRET&&env.SPOTIFY_REFRESH_TOKEN),apps:['Spotify']},{id:'rss',name:'RSS',account:rss.n+' subscriptions',connected:true,apps:['RSS Feed Viewer','RSS Feed Editor']},account,{id:'mimori',name:'Mimori',account:new URL(request.url).host,apps:['Mimori-Chat','Mimori-Admin'],connected:mimori}]});
 }catch{return json({error:'Unable to check connections'},503);}
}
export async function protocolAdminApi(request,env,{authenticate=controlSession}={}){
 if(!await authenticate(request,env))return json({error:'Sign in required'},401);
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 if(env.MIMORI_PROTOCOL_ENABLED!=='true'||!env.MIMORI_PROTOCOL_DB)return json({error:'Mimori is not configured'},503);
 try{
  // Only public identity and aggregate metadata; never key material, tokens or encrypted vaults.
  const {results}=await env.MIMORI_PROTOCOL_DB.prepare(`SELECT a.identity,a.legacy_user AS userId,a.created_at AS createdAt,
   (SELECT COUNT(*) FROM protocol_devices d WHERE d.identity=a.identity) AS devices,
   (SELECT COUNT(*) FROM protocol_links l WHERE (l.sender=a.identity OR l.recipient=a.identity) AND l.accepted=1 AND l.revoked=0) AS partners
   FROM protocol_accounts a ORDER BY a.created_at DESC LIMIT 500`).all();
  return json({accounts:results});
 }catch{return json({error:'Unable to load Mimori identities'},503);}
}
