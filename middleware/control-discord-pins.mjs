const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const valid=p=>p&&['server','dm'].includes(p.kind)&&/^\d{16,22}$/.test(p.id)&&typeof p.name==='string'&&p.name.length<=256;
export async function discordPins(request,db,owner){
 const snapshot=async()=>{const {results}=await db.prepare('SELECT kind,id,name FROM control_discord_pins WHERE owner_id=? ORDER BY rowid').bind(owner).all();return {initialized:results.some(p=>p.kind==='initialized'),pins:results.filter(p=>p.kind!=='initialized')};};
 if(request.method==='GET')return json(await snapshot());
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const raw=await request.text();if(raw.length>100000)return json({error:'Too many pins'},413);
 let data;try{data=JSON.parse(raw);}catch{return json({error:'Invalid pins'},400);}
 const marker=db.prepare("INSERT OR IGNORE INTO control_discord_pins VALUES(?,'initialized','','')").bind(owner);
 if(data.action==='initialize'||data.action==='migrate'){
  if(!Array.isArray(data.pins)||data.pins.length>400||!data.pins.every(valid))return json({error:'Invalid pins'},400);
  await db.batch([...data.pins.map(p=>data.action==='migrate'?db.prepare("INSERT OR IGNORE INTO control_discord_pins VALUES(?,?,?,?)").bind(owner,p.kind,p.id,p.name):db.prepare("INSERT OR IGNORE INTO control_discord_pins SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM control_discord_pins WHERE owner_id=? AND kind='initialized')").bind(owner,p.kind,p.id,p.name,owner)),marker]);
 }else{
  if(!valid(data)||typeof data.pinned!=='boolean')return json({error:'Invalid pin'},400);
  await db.batch([data.pinned?db.prepare('INSERT INTO control_discord_pins VALUES(?,?,?,?) ON CONFLICT(owner_id,kind,id) DO UPDATE SET name=excluded.name').bind(owner,data.kind,data.id,data.name):db.prepare('DELETE FROM control_discord_pins WHERE owner_id=? AND kind=? AND id=?').bind(owner,data.kind,data.id),marker]);
 }
 return json(await snapshot());
}
