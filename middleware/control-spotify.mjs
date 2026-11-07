import {controlSession} from './control-auth.mjs';
import {spotifyToken,clearSpotifyCache} from './connections-spotify.mjs';
import {seal,unseal,b64} from './connection-crypto.mjs';
import {token,digest} from './mimori-crypto.mjs';
const callback='https://morisoba.moe/api/control/spotify/callback',cookie='__Host-spotify-oauth',scopes='user-read-currently-playing user-read-playback-state user-modify-playback-state';
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...headers}});
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const track=t=>t?{id:t.id,title:t.name,artist:t.artists?.map(a=>a.name).join(', ')||t.show?.name||'',url:t.external_urls?.spotify||''}:null;
export async function spotifyControlApi(request,env){const u=new URL(request.url),route=u.pathname.split('/').at(-1),db=env.MIMORI_DB;try{
 if(route==='callback'){
  if(request.method!=='GET')throw fail('Method not allowed',405);
  const state=u.searchParams.get('state'),browser=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookie+'='))?.slice(cookie.length+1);
  if(u.searchParams.getAll('state').length!==1||!/^[a-f0-9]{64}$/.test(state||'')||state!==browser)throw fail('Invalid Spotify sign-in state');
  const row=await db.prepare('DELETE FROM control_spotify_oauth WHERE state_hash=? AND expires_ms>? RETURNING *').bind(digest(state),Date.now()).first();if(!row)throw fail('Sign-in expired. Start again.');
  const session=await db.prepare("SELECT s.owner_id FROM control_sessions s JOIN mimori_users u ON u.id=s.owner_id WHERE s.token_hash=? AND s.expires_ms>? AND u.id=? AND u.role='admin' AND u.disabled=0").bind(row.session_hash,Date.now(),env.CONTROL_OWNER_ID).first();if(!session)throw fail('Sign in to the control plane again',401);
  if(u.searchParams.has('error'))return Response.redirect('https://morisoba.moe/control/#spotify-cancelled',303);
  if(u.searchParams.getAll('code').length!==1)throw fail('Missing authorization code');
  const r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{Authorization:'Basic '+btoa(env.SPOTIFY_CLIENT_ID+':'+env.SPOTIFY_CLIENT_SECRET),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:u.searchParams.get('code'),redirect_uri:callback,code_verifier:await unseal(row.encrypted_verifier,env)}),signal:AbortSignal.timeout(12000),redirect:'manual'});
  if(r.status>=300&&r.status<400)throw fail('Spotify returned an unexpected redirect',502);
  const auth=await r.json();if(!r.ok||!auth.refresh_token)throw fail('Spotify authorization failed. Reconnect.',409);
  if(scopes.split(' ').some(s=>!auth.scope?.split(' ').includes(s)))throw fail('Allow playback and queue access when connecting Spotify',403);
  const check=await fetch('https://api.spotify.com/v1/me',{headers:{Authorization:'Bearer '+auth.access_token},signal:AbortSignal.timeout(10000),redirect:'manual'});if(!check.ok)throw fail('Unable to verify Spotify account',502);const me=await check.json();
  await db.prepare("INSERT INTO control_app_connections(provider,encrypted_token,account,updated_ms) VALUES('spotify',?,?,?) ON CONFLICT(provider) DO UPDATE SET encrypted_token=excluded.encrypted_token,account=excluded.account,updated_ms=excluded.updated_ms").bind(await seal(auth.refresh_token,env),me.display_name||me.id,Date.now()).run();clearSpotifyCache();
  return new Response(null,{status:303,headers:{Location:'https://morisoba.moe/control/#spotify-connected','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':cookie+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'}});
 }
 const session=await controlSession(request,env);if(!session)throw fail('Sign in required',401);
 if(request.method!=='GET'&&(request.headers.get('Origin')!==u.origin||request.headers.get('X-CSRF-Token')!==session.csrf||request.headers.get('Sec-Fetch-Site')==='cross-site'))throw fail('Session check failed',403);
 if(route==='connect'&&request.method==='POST'){
  if(u.origin!=='https://morisoba.moe'||!env.SPOTIFY_CLIENT_ID||!env.SPOTIFY_CLIENT_SECRET)throw fail('Spotify connection is not configured',503);
  const state=token(),verifier=token(),challenge=b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  await db.batch([db.prepare('DELETE FROM control_spotify_oauth WHERE expires_ms<?').bind(Date.now()),db.prepare('INSERT INTO control_spotify_oauth VALUES(?,?,?,?)').bind(digest(state),session.session_hash,await seal(verifier,env),Date.now()+600000)]);
  return json({url:'https://accounts.spotify.com/authorize?'+new URLSearchParams({client_id:env.SPOTIFY_CLIENT_ID,redirect_uri:callback,response_type:'code',scope:scopes,state,code_challenge:challenge,code_challenge_method:'S256'})},200,{'Set-Cookie':cookie+'='+state+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600'});
 }
 const commands={play:'PUT',pause:'PUT',next:'POST'},read=['state','queue'].includes(route);
 if(!(read&&request.method==='GET')&&!(commands[route]&&request.method==='POST'))throw fail('Method not allowed',405);
 const access=await spotifyToken(env),r=await fetch('https://api.spotify.com/v1/me/player'+(route==='state'?'':'/'+route),{method:read?'GET':commands[route],headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000),redirect:'manual'});
 if(!read&&r.ok)return json({ok:true});
 if(r.status===204)return json(route==='state'?{isPlaying:false,active:false}:{ok:true});
 if(r.status>=300&&r.status<400)throw fail('Spotify returned an unexpected redirect',502);
 const d=await r.json();if(!r.ok){if(r.status===401){clearSpotifyCache();throw fail('Reconnect Spotify in Connection Manager',409);}if(r.status===404)throw fail('Open Spotify on a device to start playback',409);if(r.status===429)throw fail('Spotify rate limit. Try again shortly.',429);throw fail(d.error?.reason==='PREMIUM_REQUIRED'?'Spotify Premium is required':d.error?.message||'Spotify request failed',r.status===403?403:502);}
 if(route==='queue')return json({current:track(d.currently_playing),queue:(d.queue||[]).map(track)});
 return json({active:!!d.device,isPlaying:!!d.is_playing,track:track(d.item),canPause:!d.actions?.disallows?.pausing,canPlay:!d.actions?.disallows?.resuming,canSkip:!d.actions?.disallows?.skipping_next});
 }catch(e){return json({error:e.status?e.message:request.method==='POST'?'Spotify request did not finish. Refresh before trying again.':'Spotify is unavailable'},e.status||502);}}
