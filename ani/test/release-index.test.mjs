import test from 'node:test';import assert from 'node:assert/strict';
import {indexedReleases,mappedEpisodes} from '../api/release-index.mjs';
import {releases,torrentProvider} from '../api/torrent-provider.mjs';
test('exact ID release discovery survives a rate-limited name index without account credentials',async()=>{
 const seen=[];const transport=async(url,options)=>{seen.push(url);assert.equal(options.headers?.Authorization,undefined);if(url.includes('ani.zip'))return Response.json({mappings:{anilist_id:900001,kitsu_id:13209}});if(url.includes('torrentio'))return Response.json({streams:[{infoHash:'a'.repeat(40),title:'Black Clover S01E01',behaviorHints:{filename:'episode.mkv'}}]});return new Response('',{status:429});};
 const rows=await releases({id:900001,title:'Black Clover',format:'TV'},transport,1);assert.equal(rows.length,1);assert.equal(rows[0].filename,'episode.mkv');assert.equal(seen.length,2);
 await indexedReleases({id:900001},1,transport);assert.equal(seen.length,2);
});
test('future shows never trigger release search and do not invent episodes',async()=>{
 const source=await torrentProvider(async()=>{throw new Error('must not fetch');}).search({id:900002,title:'Future',status:'NOT_YET_RELEASED',episodes:0});assert.equal(source.episodes.length,0);
});
test('unknown episode count uses only aired, numeric mapped episodes',async()=>{
 const rows=await mappedEpisodes({id:900003},async()=>Response.json({mappings:{anilist_id:900003},episodes:{1:{airDateUtc:'2026-01-01T00:00:00Z'},2:{airDateUtc:'2099-01-01T00:00:00Z'},S1:{airDateUtc:'2026-01-01T00:00:00Z'}}}));assert.deepEqual(rows,[1]);
});
test('mapping for a different AniList title is rejected',async()=>{await assert.rejects(indexedReleases({id:900004},1,async()=>Response.json({mappings:{anilist_id:1,kitsu_id:1}})),/does not match/);});

test('public browser hints resolve exact batch files without calling a blocked index',async()=>{
 const {resolveTorrent}=await import('../api/torrent-provider.mjs');const hash='c'.repeat(40);let indexCalls=0;
 const transport=async(url,options)=>{
  if(url.startsWith('https://flux.tb-cdn.io/'))return new Response('#EXTM3U\n#EXTINF:5,\nsegment.ts\n');
  if(!url.startsWith('https://api.torbox.app/')){indexCalls++;return new Response('',{status:429});}
  assert.equal(options.headers.Authorization,'Bearer test-private-key');
  let data;
  if(url.includes('checkcached'))data={[hash]:{hash}};
  else if(url.includes('createtorrent'))data={torrent_id:77};
  else if(url.includes('createstream'))data={metadata:{audios:[{language:'jpn'}]},audio_index:0,hls_url:'https://flux.tb-cdn.io/stream/index.m3u8?token=test-private-key'};
  else if(url.includes('mylist?id='))data={id:77,hash,name:'Batch',download_finished:true,download_present:true,files:[{id:8,name:'Season 1/01.mkv'},{id:12,name:'Season 3/exact-episode.mkv'}]};
  else if(url.includes('mylist'))data=[];
  else throw new Error('Unexpected TorBox request');
  return Response.json({success:true,data});
 };
 const r=await resolveTorrent({id:900005,title:'Series Season 3',episodes:12},1,'sub',{TORBOX_TOKEN:'test-private-key'},transport,false,[{hash,title:'Batch',filename:'exact-episode.mkv',episodes:[1]}]);
 assert.equal(r.status,'ready');assert.match(r.streams[0].url,/fileId=12/);assert.equal(indexCalls,0);assert.ok(!JSON.stringify(r).includes('test-private-key'));
});

test('trying another release never reselects the failed hash',async()=>{
 const {resolveTorrent}=await import('../api/torrent-provider.mjs');const hashes=['d'.repeat(40),'e'.repeat(40)];let added=[];
 const transport=async(url,options)=>{
  if(url.startsWith('https://flux.tb-cdn.io/'))return new Response('#EXTM3U\n#EXTINF:5,\nsegment.ts\n');
  if(!url.startsWith('https://api.torbox.app/'))throw new Error('unexpected index request');
  let data;if(url.includes('checkcached'))data=Object.fromEntries(hashes.map(hash=>[hash,{hash}]));
  else if(url.includes('createtorrent')){const h=options.body.get('magnet').split(':').pop();added.push(h);data={torrent_id:hashes.indexOf(h)+100};}
  else if(url.includes('createstream'))data={metadata:{audios:[{language:'jpn'}]},hls_url:'https://flux.tb-cdn.io/index.m3u8'};
  else if(url.includes('mylist?id=')){const id=Number(new URL(url).searchParams.get('id'));data={id,hash:hashes[id-100],name:'Batch',download_finished:true,download_present:true,files:[{id:0,name:'episode.mkv'}]};}
  else data=[];return Response.json({success:true,data});
 };
 const hints=hashes.map(hash=>({hash,title:'Batch',filename:'episode.mkv',episodes:[1]}));const m={id:900006,title:'Retry Series',episodes:1};
 await resolveTorrent(m,1,'sub',{TORBOX_TOKEN:'retry-test'},transport,false,hints);
 await resolveTorrent(m,1,'sub',{TORBOX_TOKEN:'retry-test'},transport,true,hints);
 assert.deepEqual(added,hashes);
});

test('brand-new shows without Kitsu mappings use exact AniList release metadata',async()=>{
 const rows=await indexedReleases({id:900007,format:'TV'},2,async url=>url.includes('ani.zip')?Response.json({mappings:{anilist_id:900007,kitsu_id:null}}):Response.json([{anilist_id:900007,episode_number:2,info_hash:'f'.repeat(40),title:'New show 02',audio:['JPN'],files:[{filename:'02.mkv'}]},{anilist_id:7,episode_number:2,info_hash:'a'.repeat(40)}]));assert.equal(rows.length,1);assert.equal(rows[0].filename,'02.mkv');assert.deepEqual(rows[0].audio,['JPN']);
});
