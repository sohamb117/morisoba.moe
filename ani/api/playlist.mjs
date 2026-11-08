import {ProviderError,httpsURL} from './provider.mjs';
export function directPlaylist(text,base,secret){
  if(!text.startsWith('#EXTM3U')||text.includes(secret))throw new ProviderError('Unsafe playback playlist','invalid_playlist');
  const resolve=value=>{const url=httpsURL(new URL(value,base).href);if(!url||!new URL(url).hostname.endsWith('.tb-cdn.io')||url.includes(secret)||/\.m3u8(?:\?|$)/i.test(url))throw new ProviderError('Unsupported playback playlist','invalid_playlist');return url;};
  return text.split(/\r?\n/).map(line=>line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_,uri)=>`URI="${resolve(uri)}"`):line.trim()?resolve(line.trim()):line).join('\n');
}
