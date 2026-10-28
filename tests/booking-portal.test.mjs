import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {hashPassword,verifyPassword} from '../middleware/mimori-crypto.mjs';
import {validateType} from '../middleware/booking-admin.mjs';
import {validSlot} from '../middleware/booking.mjs';
let mf,db,actor;
const origin='https://calendar.morisoba.moe',password='long-calendar-test-password';
const example={slug:'intro',title:'Intro meeting',description:'',location:'',timezone:'America/New_York',duration:60,days:[1,3,5],startMinute:780,endMinute:1020,noticeHours:24,horizonDays:30,enabled:true};
async function req(path,{method='GET',data,auth=false,headers={}}={}){
 if(auth&&actor){headers.Cookie=actor.cookie;headers['X-CSRF-Token']=actor.csrf;}
 if(method!=='GET'){headers.Origin??=origin;headers['Content-Type']='application/json';}
 const r=await mf.dispatchFetch(origin+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
 return {status:r.status,headers:r.headers,data:r.headers.get('Content-Type')?.includes('json')?await r.json():await r.text()};
}
before(async()=>{
 const code="import {bookingMiddleware} from './middleware/booking.mjs';export default {fetch(r,e){return bookingMiddleware(r,e,()=>new Response('fallback'));}}";
 const bundle=await build({stdin:{contents:code,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*']});
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],d1Databases:['MIMORI_DB'],bindings:{BOOKING_ADMIN_PASSWORD_HASH:await hashPassword(password)},serviceBindings:{ASSETS:r=>new Response(new URL(r.url).pathname)}}));
 db=await mf.getD1Database('MIMORI_DB');
 for(const file of ['0003_booking.sql','0004_booking_portal.sql','0005_booking_password.sql','0006_booking_management.sql'])for(const s of (await readFile('migrations/'+file,'utf8')).split(';').filter(s=>s.trim()))await db.prepare(s).run();
});
after(async()=>{await mf?.dispose();});
test('portal pages and all management endpoints require authentication',async()=>{
 for(const p of ['/admin/','/admin/login','/admin/login.html']){const r=await req(p);assert.equal(r.data,'/book/admin/login');assert.match(r.headers.get('Cache-Control'),/no-store/);assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);}
 assert.equal((await req('/book/admin/index.html')).status,404);
 const fallbackLogin=await mf.dispatchFetch('https://morisoba.moe/book/admin/login.html');assert.equal(await fallbackLogin.text(),'/book/admin/login');
 assert.equal((await req('/api/booking/admin/types')).status,401);
 assert.equal((await req('/api/booking/admin/calendar')).status,401);
 assert.equal((await req('/api/booking/admin/bookings')).status,401);
 assert.equal((await req('/api/booking/admin/types',{method:'POST',data:example})).status,401);
 assert.equal((await req('/api/booking/admin/session')).data.authenticated,false);
});
test('password login creates opaque secure sessions; cross-origin writes and missing CSRF fail',async()=>{
 assert.equal((await req('/api/booking/admin/login',{method:'POST',data:{password:'wrong'}})).status,401);
 assert.equal((await req('/api/booking/admin/login',{method:'POST',data:{password},headers:{Origin:'https://evil.example'}})).status,403);
 const r=await req('/api/booking/admin/login',{method:'POST',data:{password}});assert.equal(r.status,200);assert.match(r.headers.get('Set-Cookie'),/__Host-booking=.*HttpOnly; SameSite=Strict; Secure/);
 actor={cookie:r.headers.get('Set-Cookie').split(';')[0],csrf:r.data.csrf};
 assert.equal((await req('/api/booking/admin/calendar',{auth:true})).data.connected,false);
 assert.deepEqual((await req('/api/booking/admin/bookings',{auth:true})).data.bookings,[]);
 const stored=await db.prepare('SELECT * FROM booking_admin_sessions').first();assert.notEqual(stored.token_hash,actor.cookie.split('=')[1]);
 assert.equal((await req('/admin/',{auth:true})).data,'/book/admin/');
 assert.equal((await req('/api/booking/admin/types',{method:'POST',data:example,headers:{Cookie:actor.cookie}})).status,403);
});
test('create, edit and pause a named page; disabled pages expose no configuration',async()=>{
 const created=await req('/api/booking/admin/types',{method:'POST',auth:true,data:example});assert.equal(created.status,201);
 assert.equal((await req('/api/booking/admin/types',{method:'POST',auth:true,data:example})).status,409);
 const list=await req('/api/booking/admin/types',{auth:true});assert.equal(list.data.types[0].title,example.title);
 const config=await req('/api/booking/config?slug=intro');assert.equal(config.data.duration,60);assert.equal(config.data.ready,false);assert.equal((await req('/intro')).data,'/book/');
 const changed={...example,title:'New title',duration:45};assert.equal((await req('/api/booking/admin/types/intro',{method:'PUT',auth:true,data:changed})).status,200);
 assert.equal((await req('/api/booking/config?slug=intro')).data.duration,45);
 await req('/api/booking/admin/types/intro',{method:'PUT',auth:true,data:{...changed,enabled:false}});
 assert.equal((await req('/intro')).status,404);assert.equal((await req('/api/booking/config?slug=intro')).status,404);
});
test('booking names may begin with numbers for create, edit and guest routing',async()=>{
 const html=await readFile('book/admin/index.html','utf8');
 const pattern=html.match(/name="slug"[^>]*pattern="([^"]+)"/)[1];
 assert.equal(new RegExp('^(?:'+pattern+')$','v').test('30min'),true);
 const numeric={...example,slug:'30min',duration:30};
 assert.equal(validateType(numeric).slug,'30min');
 assert.equal((await req('/api/booking/admin/types',{method:'POST',auth:true,data:numeric})).status,201);
 assert.equal((await req('/30min')).data,'/book/');
 assert.equal((await req('/api/booking/config?slug=30min')).data.duration,30);
 assert.equal((await req('/api/booking/admin/types/30min',{method:'PUT',auth:true,data:{...numeric,title:'30 minute meeting'}})).status,200);
 assert.equal((await req('/api/booking/config?slug=30min')).data.title,'30 minute meeting');
});
test('settings reject reserved names, invalid schedules and unsupported timezones',()=>{
 for(const t of [{slug:'admin'},{slug:'../hi'},{duration:17},{timezone:'Mars'},{days:[]},{startMinute:1000,endMinute:1020},{noticeHours:100,horizonDays:1}])assert.throws(()=>validateType({...example,...t}));
 const now=Date.parse('2026-10-27T00:00:00Z');
 assert.equal(validSlot(Date.parse('2026-11-02T21:15:00Z'),{},now,example),false);
 assert.equal(validSlot(Date.parse('2026-11-02T20:00:00Z'),{},now,example),true);
 assert.equal(validSlot(Date.parse('2026-11-03T20:00:00Z'),{},now,example),false);
});
test('interval locks reject overlapping bookings across pages and roll back the reservation',async()=>{
 await db.batch([db.prepare("INSERT INTO booking_reservations(id,start_ms,status,cancel_token,created_ms) VALUES('a',100,'confirmed','a',1)"),db.prepare("INSERT INTO booking_slot_locks VALUES(100,'a')"),db.prepare("INSERT INTO booking_slot_locks VALUES(900100,'a')")]);
 await assert.rejects(db.batch([db.prepare("INSERT INTO booking_reservations(id,start_ms,status,cancel_token,created_ms,booking_slug) VALUES('b',900100,'pending','b',1,'other')"),db.prepare("INSERT INTO booking_slot_locks VALUES(900100,'b')")]));
 assert.equal(await db.prepare("SELECT id FROM booking_reservations WHERE id='b'").first(),null);
});
test('logout revokes the session and repeated failed logins are throttled',async()=>{
 const r=await req('/api/booking/admin/logout',{method:'POST',auth:true,data:{}});assert.equal(r.status,200);assert.match(r.headers.get('Set-Cookie'),/Max-Age=0/);
 assert.equal((await req('/api/booking/admin/types',{auth:true})).status,401);
 for(let i=0;i<9;i++){const r=await req('/api/booking/admin/login',{method:'POST',data:{password:'bad'}});if(i===8)assert.equal(r.status,429);}
});

test('password changes verify the current password, persist only a hash and revoke every session',async()=>{
 const login=await req('/api/booking/admin/login',{method:'POST',data:{password},headers:{'CF-Connecting-IP':'password-change'}});
 actor={cookie:login.headers.get('Set-Cookie').split(';')[0],csrf:login.data.csrf};
 const chosen='a new password chosen by the user';
 const data={currentPassword:password,newPassword:chosen,confirmPassword:chosen};
 assert.equal((await req('/api/booking/admin/password',{method:'POST',data})).status,401);
 assert.equal((await req('/api/booking/admin/password',{method:'POST',data,headers:{Cookie:actor.cookie}})).status,403);
 assert.equal((await req('/api/booking/admin/password',{method:'POST',auth:true,data:{...data,currentPassword:'wrong'}})).status,400);
 assert.equal((await req('/api/booking/admin/password',{method:'POST',auth:true,data:{...data,newPassword:'short',confirmPassword:'short'}})).status,400);
 assert.equal((await req('/api/booking/admin/password',{method:'POST',auth:true,data:{...data,confirmPassword:'different'}})).status,400);
 const other=await req('/api/booking/admin/login',{method:'POST',data:{password},headers:{'CF-Connecting-IP':'password-second'}});
 const changed=await req('/api/booking/admin/password',{method:'POST',auth:true,data});
 assert.equal(changed.status,200);assert.match(changed.headers.get('Set-Cookie'),/Max-Age=0/);
 assert.equal((await req('/api/booking/admin/session',{auth:true})).data.authenticated,false);
 assert.equal((await req('/api/booking/admin/session',{headers:{Cookie:other.headers.get('Set-Cookie').split(';')[0]}})).data.authenticated,false);
 const stored=await db.prepare('SELECT password_hash FROM booking_admin_credentials WHERE id=1').first();
 assert.match(stored.password_hash,/^scrypt:/);assert.ok(!stored.password_hash.includes(chosen));assert.equal(await verifyPassword(chosen,stored.password_hash),true);
 assert.equal((await req('/api/booking/admin/login',{method:'POST',data:{password},headers:{'CF-Connecting-IP':'old-after-change'}})).status,401);
 assert.equal((await req('/api/booking/admin/login',{method:'POST',data:{password:chosen},headers:{'CF-Connecting-IP':'new-after-change'}})).status,200);
});
test('calendar API rejects cross-origin access and serves canonical Worker asset paths',async()=>{
 const r=await mf.dispatchFetch('https://morisoba.moe/api/booking/admin/session',{headers:{Origin:'https://sohamb117.github.io'}});
 assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
 const page=await req('/default');assert.equal(page.status,200);assert.equal(page.data,'/book/');
 assert.equal(page.headers.get('Location'),null);
});

test('management and privacy pages are served directly on the calendar host',async()=>{for(const [path,asset] of [['/manage','/book/manage'],['/privacy','/book/privacy']]){const r=await req(path);assert.equal(r.status,200);assert.equal(r.data,asset);assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');}});
