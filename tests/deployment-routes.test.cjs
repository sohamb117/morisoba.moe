const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('production artifact includes Mimorigasaka shell, API routing and original durable database',()=>{
  const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
  for(const route of ['/mimorigasaka','/mimorigasaka/*','/api/mimorigasaka','/api/mimorigasaka/*'])assert.ok(config.assets.run_worker_first===true||config.assets.run_worker_first.includes(route),route);
  assert.equal(config.d1_databases.find(db=>db.binding==='MIMORI_DB').database_id,'f43ff1cb-49cb-4713-baa2-48586de779c4');
  const shell=fs.readFileSync('mimorigasaka/index.html','utf8');
  for(const match of shell.matchAll(/(?:src|href)="(\/[^"?#]+)(?:\?[^"#]*)?"/g)){
    if(match[1]==='/')continue;
    assert.ok(fs.existsSync(path.join('.',match[1])),match[1]);
  }
  assert.match(shell,/id="lock"/);assert.match(shell,/id="feed" hidden/);
});
test('every custom cursor asset exists and is a nonempty PNG; standard pointer shares arrow',()=>{
  const css=fs.readFileSync('shared/cursors.css','utf8');
  assert.match(css,/--cur-pointer: var\(--cur-arrow\)/);
  assert.doesNotMatch(css,/pointer\.png/);
  for(const [,asset] of css.matchAll(/url\("(.*?)"\)/g)){
    const buffer=fs.readFileSync(path.join('.',asset));assert.equal(buffer.subarray(1,4).toString(),'PNG');assert.ok(buffer.length>100);
  }
  for(const line of css.split('\n').filter(line=>line.includes('url(')))assert.match(line,/, none;/);
});
