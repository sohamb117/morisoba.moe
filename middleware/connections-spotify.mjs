import {seal,unseal} from './connection-crypto.mjs';
let cached;
export function clearSpotifyCache(){cached=null;}
export async function spotifyToken(env,fetcher=fetch){
 const row=env.MIMORI_DB?await env.MIMORI_DB.prepare("SELECT encrypted_token FROM control_app_connections WHERE provider='spotify'").first():null;
 const refresh=row?await unseal(row.encrypted_token,env):env.SPOTIFY_REFRESH_TOKEN;
 if(!refresh||!env.SPOTIFY_CLIENT_ID||!env.SPOTIFY_CLIENT_SECRET)throw Object.assign(Error('Connect Spotify in Connection Manager'),{status:409});
 if(cached?.source===refresh&&cached.expires>Date.now())return cached.token;
 const r=await fetcher('https://accounts.spotify.com/api/token',{method:'POST',headers:{Authorization:'Basic '+btoa(env.SPOTIFY_CLIENT_ID+':'+env.SPOTIFY_CLIENT_SECRET),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh}),signal:AbortSignal.timeout(12000),redirect:'manual'});
 if(r.status>=300&&r.status<400)throw Object.assign(Error('Spotify returned an unexpected redirect'),{status:502});
 const d=await r.json();if(!r.ok||!d.access_token)throw Object.assign(Error('Reconnect Spotify in Connection Manager'),{status:409});
 if(row&&d.refresh_token&&d.refresh_token!==refresh)await env.MIMORI_DB.prepare("UPDATE control_app_connections SET encrypted_token=?,updated_ms=? WHERE provider='spotify' AND encrypted_token=?").bind(await seal(d.refresh_token,env),Date.now(),row.encrypted_token).run();
 cached={source:d.refresh_token||refresh,token:d.access_token,expires:Date.now()+Math.max(0,d.expires_in-60)*1000};return d.access_token;
}
