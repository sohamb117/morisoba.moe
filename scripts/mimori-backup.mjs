import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync, chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const [mode,output]=process.argv.slice(2);
if(!['--local','--remote'].includes(mode)||!output)throw Error('Usage: node scripts/mimori-backup.mjs --local|--remote /private/path/backup.sql');
const query=sql=>{
 const args=['node_modules/wrangler/bin/wrangler.js','d1','execute','MIMORI_DB',mode,'--json','--command',sql];
 if(mode==='--local')args.push('--config','wrangler.local.jsonc');
 const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:64*1024*1024});
 if(r.status!==0){const err=JSON.parse(r.stdout);throw Error('Database read failed. No backup written. '+JSON.stringify(err.errors??err));}
 const parsed=JSON.parse(r.stdout);if(!parsed[0]?.success)throw Error('Database read failed.');return parsed[0].results;
};
const ident=s=>'"'+s.replaceAll('"','""')+'"';
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const schema=query("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name");
const tables=schema.filter(s=>s.type==='table');
const selects=tables.map(t=>{
 const cols=query(`PRAGMA table_info(${ident(t.name)})`);
 const values=cols.map(c=>`quote(${ident(c.name)})`).join(" || ',' || ");
 return `SELECT ${literal(t.name)} AS table_name, ${literal('INSERT INTO '+ident(t.name)+' VALUES(')} || ${values} || ');' AS statement FROM ${ident(t.name)}`;
});
// All table rows are read by one SQL statement, giving one database snapshot.
const packed=query('SELECT '+selects.map((sql,i)=>`(SELECT json_group_array(json_object('table_name',table_name,'statement',statement)) FROM (${sql})) AS t${i}`).join(','))[0];
const rows=Object.values(packed).flatMap(value=>JSON.parse(value));
const sql=['PRAGMA foreign_keys=OFF;','BEGIN TRANSACTION;',...schema.filter(s=>s.type==='table').map(s=>s.sql+';'),...rows.map(r=>r.statement),...schema.filter(s=>s.type!=='table').map(s=>s.sql+';'),'COMMIT;','PRAGMA foreign_keys=ON;',''].join('\n');
const file=resolve(output);mkdirSync(dirname(file),{recursive:true,mode:0o700});
writeFileSync(file,sql,{mode:0o600,flag:'wx'});chmodSync(file,0o600);
const counts=Object.fromEntries(tables.map(t=>[t.name,rows.filter(r=>r.table_name===t.name).length]));
writeFileSync(file+'.manifest.json',JSON.stringify({createdAt:new Date().toISOString(),sha256:createHash('sha256').update(sql).digest('hex'),counts},null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({backup:file,counts,bytes:Buffer.byteLength(sql)}));
