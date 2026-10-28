import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildCalendarPages} from '../scripts/build-calendar-pages.mjs';
test('Pages artifact has prefixed assets, admin pages, guest fallback and no server or secrets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'calendar-pages-'));
 try{
 await buildCalendarPages(dir,'/morisoba.moe');
 const html=await readFile(join(dir,'admin/index.html'),'utf8');
 assert.match(html,/src="\/morisoba\.moe\/book\/config\.js"/);
 assert.match(html,/href="\/morisoba\.moe\/shared\/typography\.css"/);
 assert.match(await readFile(join(dir,'404.html'),'utf8'),/id="booking-title"/);
 const config=await readFile(join(dir,'book/config.js'),'utf8');
 assert.match(config,/https:\/\/morisoba\.moe/);assert.match(config,/BOOKING_BASE_PATH="\/morisoba.moe"/);
 for(const item of ['middleware','migrations','worker.mjs','.dev.vars'])assert.ok(!(await readdir(dir)).includes(item));
 }finally{await rm(dir,{recursive:true,force:true});}
});
