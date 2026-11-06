import {controlAuthApi} from './control-auth.mjs';
const entries=new Set(['/control','/control/','/control/index.html']);
export async function controlPlaneMiddleware(request,env,next){
 const url=new URL(request.url),calendar=url.hostname===(env.BOOKING_HOST||'calendar.morisoba.moe');
 if(url.pathname.startsWith('/api/control/'))return controlAuthApi(request,env);
 if(/^\/(?:book\/)?admin(?:\/|$)/.test(url.pathname))return Response.redirect((calendar?'https://morisoba.moe':url.origin)+'/control/',302);
 if(calendar&&entries.has(url.pathname))return Response.redirect('https://morisoba.moe/control/',302);
 if(entries.has(url.pathname)){
  if(url.pathname==='/control')return Response.redirect(url.origin+'/control/',302);
  const response=await env.ASSETS.fetch(new Request(new URL('/control/',url),request)),out=new Response(response.body,response);
  out.headers.set('Cache-Control','no-store');out.headers.set('X-Robots-Tag','noindex, nofollow');out.headers.set('Cross-Origin-Opener-Policy','same-origin');
  out.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self' https:; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return out;
 }
 return next();
}
