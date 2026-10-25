import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {token,digest} from '../middleware/mimori-crypto.mjs';
const mode=process.argv[2];
if(!['--local','--remote'].includes(mode))throw new Error('Specify --local or --remote explicitly.');
const raw=token(),now=Date.now(),hash=digest(raw);
const sql=`INSERT INTO mimori_invites(token_hash,role,created_at,expires_at) SELECT '${hash}','admin',${now},${now+86400000} WHERE NOT EXISTS(SELECT 1 FROM mimori_users WHERE role='admin') AND NOT EXISTS(SELECT 1 FROM mimori_invites WHERE role='admin' AND claimed_by IS NULL AND revoked=0 AND expires_at>${now}); SELECT token_hash FROM mimori_invites WHERE token_hash='${hash}';`;
const args=['node_modules/wrangler/bin/wrangler.js','d1','execute','MIMORI_DB',mode,'--json','--command',sql];
if(mode==='--local')args.push('--config','wrangler.local.jsonc');
const result=spawnSync(process.execPath,args,{encoding:'utf8'});
if(result.status!==0){console.error(result.stderr||'Could not create invitation.');process.exit(1);}
const data=JSON.parse(result.stdout);
if(!data.some(r=>r.results?.some(row=>row.token_hash===hash))){console.error('An owner or pending owner invitation already exists. No new invitation was created.');process.exit(1);}
mkdirSync('.wrangler/private',{recursive:true,mode:0o700});
const file=`.wrangler/private/owner-invite${mode==='--local'?'-local':''}.txt`;
const origin=mode==='--local'?'http://127.0.0.1:8787':'https://morisoba.moe';
writeFileSync(file,origin+'/mimorigasaka/#invite='+raw+'\n',{mode:0o600});
console.log(`One-use owner invitation saved to ${file}. Expires in 24 hours. Keep it private.`);
