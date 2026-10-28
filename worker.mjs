import {sendBookingReminders} from './middleware/booking-reminders.mjs';
import {bookingMiddleware} from './middleware/booking.mjs';
import {protocolMiddleware} from './protocol/provider.mjs';
import {mimorigasakaMiddleware, session} from './middleware/mimorigasaka.mjs';
import {spotifyMiddleware} from './middleware/spotify.mjs';

export default {
  async scheduled(controller, env) { await sendBookingReminders(env); },
  fetch(request, env) {
    const url=new URL(request.url);
    if(url.pathname==='/mimorigasaka/protocol'||url.pathname.startsWith('/mimorigasaka/protocol/')){url.pathname='/mimori/'+url.pathname.slice('/mimorigasaka/protocol'.length).replace(/^\//,'');return Response.redirect(url.href,308);}
    const protocolPage=url.pathname==='/mimori'||url.pathname.startsWith('/mimori/');
    if(protocolPage&&env.MIMORI_PROTOCOL_ENABLED!=='true')return new Response('Not found',{status:404});
    return bookingMiddleware(request, env, () => protocolMiddleware(request, env, () => mimorigasakaMiddleware(request, env, () => spotifyMiddleware(request, env, async () => {
      const response = await env.ASSETS.fetch(request);
      if (!protocolPage&&!url.pathname.startsWith('/mimorigasaka')) return response;
      const secured = new Response(response.body, response);
      const connect=protocolPage?"'self' https:"+(env.MIMORI_LOCAL==='true'?" http://localhost:* http://127.0.0.1:*":''):"'self'";
      secured.headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self'${protocolPage?" 'wasm-unsafe-eval'":''}; worker-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src ${connect}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
      secured.headers.set('Referrer-Policy', 'no-referrer');
      secured.headers.set('X-Content-Type-Options', 'nosniff');
      secured.headers.set('Cache-Control', 'no-store');
      return secured;
    })), {authenticate:session}));
  }
};
