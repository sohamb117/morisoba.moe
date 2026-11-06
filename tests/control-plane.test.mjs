import {test} from 'node:test';
import assert from 'node:assert/strict';
import {controlPlaneMiddleware as handle} from '../middleware/control-plane.mjs';
const env={ASSETS:{fetch:async()=>new Response('desktop')}};
const next=()=>new Response('protected login',{headers:{'Content-Security-Policy':"default-src 'self'; frame-ancestors 'none'"}});
test('legacy admin entry points converge on the desktop',async()=>{
 for(const url of ['https://calendar.morisoba.moe/admin/','https://calendar.morisoba.moe/admin/login.html','https://morisoba.moe/book/admin/','https://morisoba.moe/admin/']){
 const r=await handle(new Request(url),env,next);assert.equal(r.status,302);assert.equal(r.headers.get('location'),'https://morisoba.moe/control/#calendar');
 }
});
test('desktop is not cached or embeddable and only frames its own origin',async()=>{
 const r=await handle(new Request('https://morisoba.moe/control/'),env,next);
 assert.equal(await r.text(),'desktop');assert.equal(r.headers.get('cache-control'),'no-store');assert.match(r.headers.get('content-security-policy'),/frame-src 'self'/);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('only explicit same-origin panel routes get the embedding exception',async()=>{
 for(const path of ['/book/admin/?panel=1','/mimorigasaka/?panel=1','/mimori/?panel=1']){
 const r=await handle(new Request('https://morisoba.moe'+path),env,next);assert.equal(await r.text(),'protected login');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.equal(r.headers.get('x-frame-options'),'SAMEORIGIN');
 }
 for(const path of ['/mimori/','/api/booking/admin/session?panel=1','/book/manage?panel=1']){
 const r=await handle(new Request('https://morisoba.moe'+path),env,next);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 }
});
test('panel mode preserves authorization failures',async()=>{
 const r=await handle(new Request('https://morisoba.moe/book/admin/?panel=1'),env,()=>new Response('Sign in required',{status:401}));assert.equal(r.status,401);assert.equal(await r.text(),'Sign in required');
});
