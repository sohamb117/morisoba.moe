import {aniSession,aniAuthApi} from '../middleware/ani-accounts.mjs';
import {handleAPI,catalog} from './api/router.mjs';
import {setCacheStore} from './api/cache.mjs';
import {controlAuthApi,controlSession} from '../middleware/control-auth.mjs';
export default {async fetch(request,env){
  setCacheStore(env.CACHE);
  const path=new URL(request.url).pathname;
  if(path.startsWith('/api/ani/'))return aniAuthApi(request,env);
  if(path.startsWith('/api/control/'))return controlAuthApi(request,env);
  const api=await handleAPI(request,env,fetch,{authorize:async r=>(await controlSession(r,env)||await aniSession(r,env))});if(api)return api;
  const response=await env.ASSETS.fetch(request);const result=new Response(response.body,response);
  result.headers.set('Referrer-Policy','no-referrer');result.headers.set('X-Content-Type-Options','nosniff');return result;
}};
