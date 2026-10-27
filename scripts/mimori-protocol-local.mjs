import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
config.name='morisoba-protocol-local';config.vars={MIMORI_LOCAL:'true',MIMORI_PROTOCOL_ENABLED:'true'};
config.d1_databases=[{binding:'MIMORI_DB',database_name:'mimori-protocol-legacy-local',database_id:'00000000-0000-0000-0000-000000000011',migrations_dir:'migrations'},{binding:'MIMORI_PROTOCOL_DB',database_name:'mimori-protocol-local',database_id:'00000000-0000-0000-0000-000000000012',migrations_dir:'protocol/migrations'}];
writeFileSync('wrangler.protocol.local.jsonc',JSON.stringify(config,null,2)+'\n');
for(const binding of ['MIMORI_DB','MIMORI_PROTOCOL_DB']){const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply',binding,'--local','--config','wrangler.protocol.local.jsonc'],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
