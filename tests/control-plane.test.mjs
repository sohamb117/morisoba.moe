import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {controlPlaneMiddleware as handle} from '../middleware/control-plane.mjs';
const env={ASSETS:{fetch:async()=>new Response('desktop')}};
const next=()=>new Response('protected login',{headers:{'Content-Security-Policy':"default-src 'self'; frame-ancestors 'none'"}});
test('all legacy admin entries redirect even with former iframe flag',async()=>{
 for(const url of ['https://calendar.morisoba.moe/admin/','https://morisoba.moe/book/admin/?panel=1','https://morisoba.moe/admin/']){const r=await handle(new Request(url),env,next);assert.equal(r.status,302);assert.equal(r.headers.get('location'),'https://morisoba.moe/control/');}
});
test('desktop disallows framing and has no iframe permission exceptions',async()=>{
 const r=await handle(new Request('https://morisoba.moe/control/'),env,next);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(r.headers.get('content-security-policy'),/frame-src 'none'/);
 for(const path of ['/mimori/?panel=1','/mimorigasaka/?panel=1'])assert.match((await handle(new Request('https://morisoba.moe'+path),env,next)).headers.get('content-security-policy'),/frame-ancestors 'none'/);
 const html=readFileSync(new URL('../control/index.html',import.meta.url),'utf8');assert.doesNotMatch(html,/<iframe/i);assert.match(html,/Copland OS Enterprise/);assert.match(html,/id="login-form"/);
});
