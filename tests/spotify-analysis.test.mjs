import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {getAnalysis,normalizeGrid} from '../middleware/spotify-analysis.mjs';
const visual = createRequire(import.meta.url)('../shared/spotify-visualizer.js');
function kv() {
 const records=new Map();return {records,async get(key){return records.get(key)||null;},async put(key,value){records.set(key,JSON.parse(value));}};
}
test('cached grid is shared across visitors and concurrent misses are coalesced',async()=>{
 const store=kv();let calls=0;
 const track={id:'grid-test',durationMs:10000};
 const fetcher=async()=>{calls++;return Response.json({tempo:120,beats:[.2,.7,1.2],downbeats:[.2]});};
 const env={SPOTIFY_ANALYSIS:store,BRIZM_API_KEY:'fake-test-key'};
 const [first,second]=await Promise.all([getAnalysis(track,env,fetcher),getAnalysis(track,env,fetcher)]);
 assert.equal(first.mode,'beatgrid');assert.deepEqual(first,second);assert.equal(calls,1);
 await getAnalysis(track,env,fetcher);assert.equal(calls,1);assert.equal(store.records.size,1);
});
test('missing or unreadable durable cache never spends Brizm quota',async()=>{
 for (const [suffix,store] of [['missing',undefined],['broken',{get(){throw Error('unavailable');}}]]) {
  const urls=[];
  const result=await getAnalysis({id:'guard-'+suffix,durationMs:10000},{BRIZM_API_KEY:'fake',SPOTIFY_ANALYSIS:store},async url=>{urls.push(url);return Response.json({content:[]});});
  assert.equal(result.mode,'ambient');assert.ok(urls.every(url=>!url.includes('brizm.dev')));
 }
});
test('provider failure uses measured tempo and feature-derived style',async()=>{
 const id='fallback-test',urls=[];
 const result=await getAnalysis({id,durationMs:10000},{BRIZM_API_KEY:'fake',SPOTIFY_ANALYSIS:kv()},async url=>{
  urls.push(url);
  if(url.includes('brizm.dev'))return new Response('',{status:429});
  if(url.includes('?ids='))return Response.json({content:[{id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',href:'https://open.spotify.com/track/'+id}]});
  return Response.json({tempo:138,energy:.9,acousticness:.1,danceability:.5});
 });
 assert.equal(result.mode,'tempo');assert.equal(result.features.tempo,138);assert.equal(visual.profile(result).style,'intense');assert.equal(urls.length,3);
});
test('durable hit avoids provider calls and wrong track mappings are not used',async()=>{
 const track={id:'durable-test',durationMs:1000};const store=kv();
 const value={version:1,trackId:track.id,mode:'beatgrid',beats:[0,.2,.4],downbeats:[],features:{tempo:120}};
 store.records.set('analysis:v1:brizm:'+track.id,value);
 assert.deepEqual(await getAnalysis(track,{SPOTIFY_ANALYSIS:store,BRIZM_API_KEY:'fake'},()=>{throw Error('must not fetch');}),value);
 const mismatch=await getAnalysis({id:'wrong-match',durationMs:1000},{},async()=>Response.json({content:[{href:'https://open.spotify.com/track/other',id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}]}));
 assert.equal(mismatch.source,'default');
});
test('beat normalization rejects malformed times and synthesis follows actual beat positions',()=>{
 assert.deepEqual(normalizeGrid({beats:[1,.2,.2,NaN,-1,100,.7],downbeats:[.2]},2000).beats,[.2,.7,1]);
 assert.equal(normalizeGrid({beats:[0,1]},10000),null);
 const a={mode:'beatgrid',features:{energy:.8},beats:[.2,.7,1.2],downbeats:[.2]};
 assert.ok(visual.amplitude(a,.7)>visual.amplitude(a,.65));
 assert.equal(visual.points(a,.7,false),visual.points(a,1.2,false));
 assert.notEqual(visual.points(a,.7,true),visual.points(a,.65,true));
 assert.equal(visual.previous(a.beats,.1),null);
});
