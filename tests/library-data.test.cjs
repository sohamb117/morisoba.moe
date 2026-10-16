const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../library/data.js');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../data', name)));
const local = read('library.json');
const snapshots = ['letterboxd','myanimelist'].map(s => read(`imports/${s}.json`));
const links = read('library-links.json');
const items = M.merge(local, snapshots, links);

test('all handwritten fields and notes survive exactly; no input mutation', () => {
  const before = JSON.stringify(local);
  const merged = M.merge(local,snapshots,links);
  for (const kind of ['books','films','shows']) for (const entry of local[kind]) {
    const match = merged.find(i => i.source === 'local' && i.title === entry.title && i.kind === kind);
    for (const [key,value] of Object.entries(entry)) assert.deepEqual(match[key], value);
  }
  assert.equal(JSON.stringify(local),before);
});
test('explicit links retain both ratings and preserve series shelf', () => {
  const film = items.find(i=>i.title === '964 pinocchio');
  assert.equal(film.rating,3);
  assert.equal(film.imports[0].rating,snapshots[0].entries.find(e=>e.id==='letterboxd:964-pinocchio').rating);
  const lain = items.find(i=>i.title === 'serial experiments lain');
  assert.equal(lain.kind,'shows');
  assert.equal(items.filter(i=>i.imports.some(e=>e.id==='letterboxd:serial-experiments-lain')).length,1);
});
test('provider identity links, duplicate IDs and translated-title search', () => {
  const yourName = items.find(i=>i.imports.some(e=>e.id==='myanimelist:anime:32281'));
  assert.equal(yourName.imports.length,2);
  assert.equal(M.filter(items,{query:'Kimi no Na wa.'})[0].id,yourName.id);
  assert.equal(M.merge(local,[...snapshots,...snapshots],links).length,items.length);
});
test('same-title remakes are not fuzzy merged', () => {
  const source={entries:[{id:'a',title:'Same',kind:'films',source:'letterboxd'},{id:'b',title:'Same',kind:'films',source:'letterboxd'}]};
  assert.equal(M.merge({},[source],[]).length,2);
});
test('planned titles do not inflate in-progress count and all statuses filter', () => {
  for(const state of ['planned','completed','in progress','on hold','dropped']) {
    assert.ok(M.filter(items,{state}).length);
    assert.ok(M.filter(items,{state}).every(i=>M.status(i)===state));
  }
  assert.equal(M.status({started:'2026',finished:'2026'}),'completed');
});
test('source filter includes linked handwritten entries; no-result search works', () => {
  assert.ok(M.filter(items,{source:'letterboxd'}).some(i=>i.title==='964 pinocchio'));
  assert.equal(M.filter(items,{source:'local'}).length,4);
  assert.equal(M.filter(items,{query:'does not exist 9128'}).length,0);
});
test('ratings compare on normalized scale, keep half scores and unrated last', () => {
  const list=[{title:'A',rating:4,ratingMax:5,imports:[]},{title:'B',rating:9,ratingMax:10,imports:[]},{title:'C',rating:null,imports:[]}];
  assert.deepEqual(M.filter(list,{sort:'rating'}).map(i=>i.title),['B','A','C']);
  assert.equal(M.rating({rating:3.5}), '3.5/5');
  assert.equal(M.rating({rating:null}), 'unrated');
});
test('missing import sources still show the original library', () => {
  assert.equal(M.merge(local,[],links).length,4);
});
test('external links reject script, foreign hosts and embedded credentials', () => {
  for (const url of ['javascript:alert(1)','https://evil.example','https://u:p@letterboxd.com','https://letterboxd.com.evil.example']) assert.equal(M.safeUrl(url),null);
  assert.equal(M.safeUrl('https://letterboxd.com/film/akira/'),'https://letterboxd.com/film/akira/');
});

test('malformed snapshots are rejected before rendering', () => {
  assert.ok(snapshots.every(M.validSnapshot));
  for (const value of [null, {}, {schemaVersion:1, entries:[]}]) assert.ok(!M.validSnapshot(value));
  assert.ok(!M.validSnapshot({...snapshots[0],entries:[{...snapshots[0].entries[0],rating:20}]}));
});
