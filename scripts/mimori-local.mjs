import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
config.name='morisoba-local';
config.vars={...config.vars,MIMORI_LOCAL:'true'};
config.d1_databases=[{binding:'MIMORI_DB',database_name:'mimorigasaka-local',database_id:'00000000-0000-0000-0000-000000000001',migrations_dir:'migrations'}];
writeFileSync('wrangler.local.jsonc',JSON.stringify(config,null,2)+'\n');
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','MIMORI_DB','--local','--config','wrangler.local.jsonc'],{stdio:'inherit'});
process.exitCode=result.status||0;
