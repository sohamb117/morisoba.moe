import {spotifyControlApi} from './control-spotify.mjs';
import {remiliaApi} from './control-remilia.mjs';
import {discordApi} from './control-discord.mjs';
import {controlAppsApi} from './control-apps.mjs';
import {connectionsApi,protocolAdminApi} from './control-connections.mjs';
import {calendarOAuth} from './control-calendar-oauth.mjs';
import {controlCalendarApi} from './control-calendar.mjs';
import {controlAuthApi} from './control-auth.mjs';
const entries=new Set(['/control','/control/','/control/index.html']);
export async function controlPlaneMiddleware(request,env,next){
 const url=new URL(request.url),calendar=url.hostname===(env.BOOKING_HOST||'calendar.morisoba.moe');
 if(['/api/control/calendar/connect','/api/control/calendar/callback'].includes(url.pathname))return calendarOAuth(request,env);
 if(url.pathname.startsWith('/api/control/spotify/'))return spotifyControlApi(request,env);
 if(url.pathname.startsWith('/api/control/remilia/'))return remiliaApi(request,env);
 if(url.pathname.startsWith('/api/control/discord/'))return discordApi(request,env);
 if(/^\/api\/control\/(github|rss)\//.test(url.pathname))return controlAppsApi(request,env);
 if(url.pathname==='/api/control/connections')return connectionsApi(request,env);
 if(url.pathname==='/api/control/mimori')return protocolAdminApi(request,env);
 if(url.pathname.startsWith('/api/control/calendar/'))return controlCalendarApi(request,env);
 if(url.pathname.startsWith('/api/control/'))return controlAuthApi(request,env);
 if(/^\/(?:book\/)?admin(?:\/|$)/.test(url.pathname))return Response.redirect((calendar?'https://morisoba.moe':url.origin)+'/control/',302);
 if(calendar&&entries.has(url.pathname))return Response.redirect('https://morisoba.moe/control/',302);
 if(entries.has(url.pathname)){
  if(url.pathname==='/control')return Response.redirect(url.origin+'/control/',302);
  const response=await env.ASSETS.fetch(new Request(new URL('/control/',url),request)),out=new Response(response.body,response);
  out.headers.set('Cache-Control','no-store');out.headers.set('X-Robots-Tag','noindex, nofollow');out.headers.set('Cross-Origin-Opener-Policy','same-origin');
  out.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com https://i.scdn.co; font-src 'self'; connect-src 'self' https:; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return out;
 }
 return next();
}
