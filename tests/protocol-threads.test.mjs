import test from 'node:test';
import assert from 'node:assert/strict';
import {buildThreads} from '../protocol/threads.mjs';
const post=(id,time)=>({id,payload:{type:'post',createdAt:time}});
const reply=(id,root,target,time)=>({id,payload:{type:'reply',root,target,createdAt:time}});
test('replies and nested replies stay with their root, ordered oldest first',()=>{
 const root=post('root',1),other=post('other',4),a=reply('a','root','root',2),b=reply('b','root','a',3);
 const threads=buildThreads([b,other,a,root]);
 assert.deepEqual(threads.map(t=>t.id),['other','root']);
 assert.deepEqual(threads[1].replies,[a,b]);assert.equal(threads[1].post,root);
 assert.equal(threads.flatMap(t=>t.replies).length,2);
});
test('missing root does not hide surviving replies or turn them into standalone posts',()=>{
 const record=reply('reply','deleted','deleted',5),threads=buildThreads([record]);
 assert.equal(threads.length,1);assert.equal(threads[0].post,null);assert.deepEqual(threads[0].replies,[record]);
});
test('equal-time order is stable and input is not modified',()=>{
 const records=[post('b',1),post('a',1)],copy=structuredClone(records);
 assert.deepEqual(buildThreads(records).map(t=>t.id),['a','b']);assert.deepEqual(records,copy);
});
