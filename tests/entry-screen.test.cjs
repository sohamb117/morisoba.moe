const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function harness(){
 const fonts=deferred(),image=deferred(),classes=new Set(['entry-pending']);let timeout,ready;
 const window={};
 vm.runInNewContext(fs.readFileSync('shared/entry-screen.js','utf8'),{window,Promise,Error,document:{readyState:'interactive',addEventListener:(_,fn)=>ready=fn,documentElement:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}},getElementById:()=>({querySelector:()=>({decode:()=>image.promise})}),fonts:{load:()=>fonts.promise}},setTimeout:fn=>(timeout=fn,1),clearTimeout(){},requestAnimationFrame:fn=>fn()});
 return {fonts,image,classes,window,timeout:()=>timeout(),ready:()=>ready()};
}
test('entry remains concealed until fonts, emblem and page handlers are ready',async()=>{
 const h=harness();h.fonts.resolve([{}]);await Promise.resolve();assert.ok(h.classes.has('entry-pending'));h.image.resolve();await new Promise(setImmediate);assert.ok(h.classes.has('entry-pending'));h.ready();await h.window.MorisobaEntryReady;assert.ok(!h.classes.has('entry-pending'));assert.ok(!h.classes.has('entry-font-fallback'));
});
test('failed fonts reveal stable fallback instead of stranding controls',async()=>{
 const h=harness();h.ready();h.fonts.reject(new Error('offline'));await h.window.MorisobaEntryReady;assert.ok(!h.classes.has('entry-pending'));assert.ok(h.classes.has('entry-font-fallback'));
});
test('stalled assets time out; late fonts cannot replace the chosen fallback',async()=>{
 const h=harness();h.ready();h.timeout();await h.window.MorisobaEntryReady;assert.ok(!h.classes.has('entry-pending'));assert.ok(h.classes.has('entry-font-fallback'));h.fonts.resolve([{}]);h.image.resolve();await new Promise(setImmediate);assert.ok(h.classes.has('entry-font-fallback'));
});
