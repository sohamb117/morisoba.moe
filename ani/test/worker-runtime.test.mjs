import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('deployed Worker runtime can fetch and cache the catalogue',async()=>{
 const bundle=await build({entryPoints:[new URL('../worker.mjs',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});let calls=0;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-26',compatibilityFlags:['nodejs_compat'],kvNamespaces:['CACHE'],outboundService:()=>{calls++;return Response.json({data:{Page:{media:[{id:1,title:{english:'Runtime sample'},format:'TV',episodes:2,status:'RELEASING',synonyms:[],seasonYear:2026}]}}});}}));
 try{for(let i=0;i<2;i++){const r=await mf.dispatchFetch('https://ani.test/api/search');const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));assert.equal(data.results[0].title,'Runtime sample');}assert.equal(calls,1);}finally{await mf.dispose();}
});
test('Worker searches Kitsu after AniList rejects its requests and caches title details',async()=>{
 const bundle=await build({entryPoints:[new URL('../worker.mjs',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});let primary=0,backup=0;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-26',compatibilityFlags:['nodejs_compat'],kvNamespaces:['CACHE'],outboundService:r=>{if(new URL(r.url).hostname==='graphql.anilist.co'){primary++;return new Response('blocked',{status:403});}backup++;return Response.json({data:[{id:'51',attributes:{canonicalTitle:'Backup show',titles:{en:'Backup show'},status:'current',subtype:'TV'}}]});}}));
 try{let r=await mf.dispatchFetch('https://ani.test/api/search?q=backup');assert.equal(r.status,200);const j=await r.json();assert.equal(j.results[0].id,200000051);r=await mf.dispatchFetch('https://ani.test/api/titles/200000051');assert.equal((await r.json()).title,'Backup show');await mf.dispatchFetch('https://ani.test/api/search?q=other');assert.equal(primary,1);assert.equal(backup,2);}finally{await mf.dispose();}
});
test('TorBox account requests work with Worker fetch receiver and redirect semantics',async()=>{
 const bundle=await build({stdin:{contents:"import {TorBoxClient} from './ani/api/torbox.mjs';export default {async fetch(){return Response.json(await new TorBoxClient('test-only-key',fetch).account());}}",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-26',compatibilityFlags:['nodejs_compat'],outboundService:()=>Response.json({success:true,data:{plan:2}})}));
 try{const r=await mf.dispatchFetch('https://ani.test/account');assert.equal(r.status,200);assert.equal((await r.json()).connected,true);}finally{await mf.dispose();}
});
