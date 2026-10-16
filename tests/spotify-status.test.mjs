import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nowPlaying, spotifyMiddleware} from '../middleware/spotify.mjs';
import worker from '../worker.mjs';
const env = {SPOTIFY_CLIENT_ID:'client',SPOTIFY_CLIENT_SECRET:'secret',SPOTIFY_REFRESH_TOKEN:'refresh'};
test('missing credentials produces honest disconnected state', async () => {
  assert.deepEqual(await nowPlaying({}, () => {throw Error('must not fetch');}), {state:'not connected'});
});
test('returns only public track fields and handles pause and no playback', async () => {
  let call = 0;
  const result = await nowPlaying(env, async () => ++call === 1 ? Response.json({access_token:'private-token',expires_in:3600}) : Response.json({is_playing:false,progress_ms:1234,item:{type:'track',id:'test-track',name:'Track',artists:[{name:'A'},{name:'B'}],album:{name:'Album',images:[{url:'https://i.scdn.co/image/test'}]},external_urls:{spotify:'https://open.spotify.com/track/test'},duration_ms:123000}}));
  assert.equal(typeof result.sampledAt,'number');
  const {sampledAt,...publicTrack}=result;
  assert.deepEqual(publicTrack,{id:'test-track',isPlaying:false,title:'Track',artist:'A, B',album:'Album',art:'https://i.scdn.co/image/test',url:'https://open.spotify.com/track/test',progressMs:1234,durationMs:123000});
  assert.deepEqual(await nowPlaying(env, async () => new Response(null,{status:204})),{state:'off air'});
  assert.deepEqual(await nowPlaying(env, async () => Response.json({item:{type:'episode'}})),{state:'off air'});
});
test('rejects upstream failures without leaking response secrets', async () => {
  await assert.rejects(nowPlaying(env, async () => new Response('private',{status:500})), /Spotify unavailable/);
});
test('middleware passes non-Spotify requests to existing asset handler and rejects writes', async () => {
  const assets = {fetch: request => new Response('existing page: ' + new URL(request.url).pathname)};
  assert.equal(await (await worker.fetch(new Request('https://morisoba.moe/'),{ASSETS:assets})).text(),'existing page: /');
  assert.equal(await (await spotifyMiddleware(new Request('https://morisoba.moe/library/'),{},() => new Response('library'))).text(),'library');
  assert.equal((await worker.fetch(new Request('https://morisoba.moe/api/spotify',{method:'POST'}),{})).status,405);
});
