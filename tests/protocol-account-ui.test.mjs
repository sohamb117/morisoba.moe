import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../protocol/browser.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
async function page(role){
 const elements=new Map(),requests=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,disabled:false,value:'',textContent:'',setAttribute(){},handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});return elements.get(id);};
 class ProviderClient{constructor(origin,{csrf}){this.csrf=csrf;}async request(){return {vault:{}};}}
 const context=vm.createContext({document:{getElementById:element,querySelectorAll:()=>[]},location:{origin:'https://example.test'},ProviderClient,matchMedia:()=>({matches:false,addEventListener(){}}),fetch:async(path,options)=>{requests.push({path,options});return {ok:true,json:async()=>path.endsWith('/session')?{user:{username:'morisoba',role},csrf:'csrf-token'}:{token:'test-invite'}};},console});
 vm.runInContext(source,context);await new Promise(resolve=>setImmediate(resolve));
 return {element,requests};
}
test('admin invitations remain accessible before identity unlock and reuse private provider invitations',async()=>{
 const {element,requests}=await page('admin');
 assert.equal(element('account').hidden,false);assert.equal(element('account-admin').hidden,false);
 assert.equal(element('identity-toggle').textContent,'C:morisoba>');
 assert.equal(requests.length,1);
 await element('invite-people').handlers.click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests[1].path,'/api/mimorigasaka/invites');assert.equal(requests[1].options.headers['X-CSRF-Token'],'csrf-token');
 assert.equal(element('account-invite-link').value,'https://example.test/mimorigasaka/#invite=test-invite');
 assert.equal(element('account-invite').hidden,false);
});
test('ordinary accounts get account controls without admin invitation controls',async()=>{
 const {element,requests}=await page('member');assert.equal(element('account').hidden,false);assert.equal(element('account-admin').hidden,true);assert.equal(requests.length,1);
});
