import {spotifyMiddleware} from './middleware/spotify.mjs';

export default {
  fetch(request, env) {
    return spotifyMiddleware(request, env, () => env.ASSETS.fetch(request));
  }
};
