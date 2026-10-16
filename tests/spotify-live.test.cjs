const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../shared/spotify-status.js'),'utf8');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function harness(responses) {
 const elements=new Map(),events={},timers=new Map();let seq=0,calls=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,style:{},classList:{contains:()=>false},getClientRects:()=>[{}],addEventListener(){},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}});return elements.get(id);};
 const document={hidden:false,getElementById:element,addEventListener:(name,fn)=>events[name]=fn};
 const window={SpotifyVisualizer:require('../shared/spotify-visualizer.js'),addEventListener:(name,fn)=>events[name]=fn};
 const context={document,window,matchMedia:()=>({matches:false}),MutationObserver:class{observe(){}},performance:{now:()=>0},Date,AbortSignal,requestAnimationFrame(){},setInterval(){},setTimeout:(fn,delay)=>{const id=++seq;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),fetch:async()=>{const response=responses[Math.min(calls++,responses.length-1)];if(typeof response==='function')return response();return {ok:true,status:200,json:async()=>response};}};
 vm.runInNewContext(source,context);
 return {element,events,document,timers,get calls(){return calls;},async next(){const [id,timer]=[...timers][0];timers.delete(id);await timer.fn();await flush();}};
}
const track=(title,extra={})=>({id:title,title,artist:'Artist',album:'Album',url:'https://open.spotify.com/track/'+title,art:'https://i.scdn.co/image/'+title,isPlaying:true,progressMs:1000,durationMs:180000,sampledAt:Date.now(),...extra});
test('idle starts and subsequent skips update all metadata without reload',async()=>{
 // No IDs in fixtures avoids unrelated analysis fetches; metadata uses the same render path.
 const h=harness([{state:'off air'},track('first',{id:undefined}),track('second',{id:undefined})]);await flush();
 assert.equal(h.element('spotify-state').textContent,'spotify · off air');assert.equal([...h.timers.values()][0].delay,3000);
 await h.next();assert.equal(h.element('spotify-title').textContent,'first');
 await h.next();assert.equal(h.element('spotify-title').textContent,'second');assert.equal(h.element('spotify-art').src,'https://i.scdn.co/image/second');
});
test('hidden pages stop network requests and returning refreshes immediately',async()=>{
 const h=harness([{state:'off air'}]);await flush();const calls=h.calls;
 h.document.hidden=true;h.events.visibilitychange();assert.equal(h.timers.size,0);
 h.document.hidden=false;h.events.visibilitychange();await flush();assert.equal(h.calls,calls+1);
});
test('near song endings refresh sooner than normal poll interval',async()=>{
 const h=harness([track('ending',{id:undefined,durationMs:2000,progressMs:1800})]);await flush();
 assert.equal([...h.timers.values()][0].delay,750);
});
test('simultaneous focus and network events do not create overlapping fetches',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);
 const h=harness([()=>pending]);await flush();
 h.events.focus();h.events.online();h.events.pageshow();await flush();assert.equal(h.calls,1);
 resolve({ok:true,status:200,json:async()=>({state:'off air'})});await flush();assert.equal(h.timers.size,1);
});
