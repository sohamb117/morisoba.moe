import {mimorigasakaMiddleware} from './middleware/mimorigasaka.mjs';
import {spotifyMiddleware} from './middleware/spotify.mjs';

export default {
  fetch(request, env) {
    return mimorigasakaMiddleware(request, env, () => spotifyMiddleware(request, env, async () => {
      const response = await env.ASSETS.fetch(request);
      if (!new URL(request.url).pathname.startsWith('/mimorigasaka')) return response;
      const secured = new Response(response.body, response);
      secured.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      secured.headers.set('Referrer-Policy', 'no-referrer');
      secured.headers.set('X-Content-Type-Options', 'nosniff');
      secured.headers.set('Cache-Control', 'no-store');
      return secured;
    }));
  }
};
