import test from 'node:test';import assert from 'node:assert/strict';import{handleDebrid}from'../api/real-debrid.mjs';
const env={TORBOX_TOKEN:'test-key'};const req=(path,body)=>new Request('https://ani.test/api/debrid/'+path,{method:body?'POST':'GET',headers:{Origin:'https://ani.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('browser AniList metadata is isolated to its authenticated viewer',async()=>{
 const media={id:12345,title:'Viewer title',episodes:2,format:'TV'};const context=id=>({authorize:async()=>({id}),catalog:async()=>[{id:12345,title:'Authoritative title',episodes:3,format:'TV'}]});
 assert.equal((await handleDebrid(req('catalog',{media}),env,fetch,context('one'))).status,200);
 const one=await (await handleDebrid(req('episodes?mediaId=12345'),env,fetch,context('one'))).json();const two=await (await handleDebrid(req('episodes?mediaId=12345'),env,fetch,context('two'))).json();
 assert.equal(one.sources[0].episodes.filter(e=>e.audio==='sub').length,2);assert.equal(two.sources[0].episodes.filter(e=>e.audio==='sub').length,3);
});
test('anonymous clients cannot seed catalogue metadata',async()=>{assert.equal((await handleDebrid(req('catalog',{media:{id:1,title:'x'}}),env,fetch,{authorize:async()=>false})).status,401);});
