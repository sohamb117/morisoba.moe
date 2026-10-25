const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function harness(){
  let now=100, sounds=0, navigations=[];
  const listeners={},timers=[];
  const param=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){}});
  class AudioContext {
    state='running';currentTime=0;destination={};
    createOscillator(){return {frequency:param(),connect(){},start(){sounds++},stop(){},disconnect(){}}}
    createGain(){return {gain:param(),connect(){},disconnect(){}}}
    createBiquadFilter(){return {frequency:{},connect(){},disconnect(){}}}
  }
  const location={href:'https://morisoba.moe/',origin:'https://morisoba.moe',pathname:'/',search:'',assign:u=>navigations.push(u),replace:u=>navigations.push(u)};
  const window={AudioContext,setTimeout:fn=>timers.push(fn),addEventListener:(type,fn)=>listeners['capture:'+type]=fn,open:u=>navigations.push(u)};
  vm.runInNewContext(fs.readFileSync('shared/ui-sound.js','utf8'),{window,location,URL,localStorage:{getItem(){},setItem(){}},performance:{now:()=>now},document:{addEventListener:(type,fn)=>listeners[type]=fn}});
  function click({control=false,trusted=true,disabled=false,link=null,marked=false,mod=false}={}){
    const target={closest(selector){
      if(selector.includes('[inert]'))return disabled?{}:null;
      if(selector==='a[href]')return link;
      if(selector.startsWith('.pbtn'))return control?{}:null;
      if(selector.startsWith('.ui-sound-nav'))return marked?{hasAttribute:()=>false,getAttribute:()=>null,matches:()=>false}:null;
      return null;
    }};
    const e={isTrusted:trusted,target,button:0,defaultPrevented:false,cancelable:true,ctrlKey:mod,preventDefault(){this.defaultPrevented=true}};
    listeners['capture:click'](e);listeners.click(e);return e;
  }
  return {click,ui:window.MorisobaUI,advance:()=>now+=500,flush:()=>timers.splice(0).forEach(fn=>fn()),sounds:()=>sounds,navigations};
}
function link(href,attrs={}){return {href,dataset:{},rel:'',hasAttribute:k=>Object.hasOwn(attrs,k),getAttribute:k=>k==='href'?href:attrs[k]??null};}
test('selection capture sounds stopped panel clicks but not delayed synthetic replay or boot clicks',()=>{
  const h=harness();h.click({control:true});assert.equal(h.sounds(),1);h.advance();h.click({control:true,trusted:false});assert.equal(h.sounds(),1);h.advance();h.click({control:true});assert.equal(h.sounds(),2);
});
test('marked controls do not double play through capture and bubble; disabled controls and mute are silent',()=>{
  const h=harness();h.click({control:true,marked:true});assert.equal(h.sounds(),1);h.advance();h.click({control:true,marked:true,disabled:true});assert.equal(h.sounds(),1);h.ui.setMuted(true);h.advance();h.click({control:true});assert.equal(h.sounds(),1);
});
test('same-origin page links keep one chirp and delayed navigation; modifiers stay native',()=>{
  const h=harness();const e=h.click({link:link('https://morisoba.moe/mimorigasaka/')});assert.equal(h.sounds(),1);assert.ok(e.defaultPrevented);assert.equal(h.navigations.length,0);h.flush();assert.deepEqual(h.navigations,['https://morisoba.moe/mimorigasaka/']);h.advance();const modified=h.click({link:link('https://morisoba.moe/library/'),mod:true});assert.equal(modified.defaultPrevented,false);h.flush();assert.equal(h.navigations.length,1);
});
test('same-document hashes and downloads do not navigate or sound',()=>{
  const h=harness();h.click({link:link('https://morisoba.moe/#p-console')});h.click({link:link('https://morisoba.moe/resume.pdf',{download:''})});assert.equal(h.sounds(),0);h.flush();assert.equal(h.navigations.length,0);
});
test('programmatic Business and Log Out navigation sounds once and respects replace',()=>{
  const h=harness();h.ui.navigate('resume/');assert.equal(h.sounds(),1);h.flush();assert.deepEqual(h.navigations,['resume/']);h.advance();h.ui.navigate('/',{replace:true});assert.equal(h.sounds(),2);h.flush();assert.deepEqual(h.navigations,['resume/','/']);
});
