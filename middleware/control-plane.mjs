const controlPaths=new Set(['/control','/control/','/control/index.html']);
const calendarPaths=new Set(['/admin','/admin/','/admin/login','/admin/login.html']);
const bookingPaths=new Set(['/book/admin/','/book/admin/login','/book/admin/login.html']);
const embeddedPaths=new Set([...bookingPaths,'/mimorigasaka/','/mimorigasaka/index.html','/mimori/','/mimori/index.html']);
export async function controlPlaneMiddleware(request,env,next){
 const url=new URL(request.url);
 const calendarHost=url.hostname===(env.BOOKING_HOST||'calendar.morisoba.moe');
 if(calendarHost&&(calendarPaths.has(url.pathname)||controlPaths.has(url.pathname))){return Response.redirect('https://morisoba.moe/control/#calendar',302);}
 if(!calendarHost&&calendarPaths.has(url.pathname))return Response.redirect(url.origin+'/control/#calendar',302);
 if(!calendarHost&&bookingPaths.has(url.pathname)&&url.searchParams.get('panel')!=='1')return Response.redirect(url.origin+'/control/#calendar',302);
 if(controlPaths.has(url.pathname)){
  if(url.pathname==='/control')return Response.redirect(url.origin+'/control/',302);
  const response=await env.ASSETS.fetch(new Request(new URL('/control/',url),request));
  const result=new Response(response.body,response);
  result.headers.set('Cache-Control','no-store');
  result.headers.set('X-Robots-Tag','noindex, nofollow');
  result.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return result;
 }
 const response=await next();
 if(!calendarHost&&embeddedPaths.has(url.pathname)&&url.searchParams.get('panel')==='1'){
  const result=new Response(response.body,response);
  const policy=result.headers.get('Content-Security-Policy');
  if(policy)result.headers.set('Content-Security-Policy',policy.replace("frame-ancestors 'none'","frame-ancestors 'self'"));
  result.headers.set('X-Frame-Options','SAMEORIGIN');
  result.headers.set('Cache-Control','no-store');
  return result;
 }
 return response;
}
