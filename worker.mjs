import {protocolMiddleware} from './protocol/provider.mjs';
import {mimorigasakaMiddleware, session} from './middleware/mimorigasaka.mjs';
import {spotifyMiddleware} from './middleware/spotify.mjs';

export default {
  fetch(request, env) {
    const protocolPage=new URL(request.url).pathname.startsWith('/mimorigasaka/protocol');
    if(protocolPage&&env.MIMORI_PROTOCOL_ENABLED!=='true')return new Response('Not found',{status:404});
    return protocolMiddleware(request, env, () => mimorigasakaMiddleware(request, env, () => spotifyMiddleware(request, env, async () => {
      const response = await env.ASSETS.fetch(request);
      if (!new URL(request.url).pathname.startsWith('/mimorigasaka')) return response;
      const secured = new Response(response.body, response);
      const connect=protocolPage?"'self' https:"+(env.MIMORI_LOCAL==='true'?" http://localhost:* http://127.0.0.1:*":''):"'self'";
      secured.headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src ${connect}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
      secured.headers.set('Referrer-Policy', 'no-referrer');
      secured.headers.set('X-Content-Type-Options', 'nosniff');
      secured.headers.set('Cache-Control', 'no-store');
      return secured;
    })), {authenticate:session});
  }
};
