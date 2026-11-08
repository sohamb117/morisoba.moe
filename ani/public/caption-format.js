const seconds=value=>value.trim().replace(',','.').split(':').reduce((n,x)=>n*60+Number(x),0);
export function parseCues(text){
 if(/^\[Events\]/mi.test(text)){
  let fields=[],events=false;const cues=[];
  for(const line of text.replace(/\r/g,'').split('\n')){
   if(/^\[/.test(line)){events=/^\[Events\]/i.test(line);continue;}if(!events)continue;
   if(/^Format:/i.test(line)){fields=line.slice(7).split(',').map(s=>s.trim().toLowerCase());continue;}
   if(!/^Dialogue:/i.test(line)||!fields.includes('text'))continue;
   const parts=line.slice(9).split(',');const ti=fields.indexOf('text');
   const start=seconds(parts[fields.indexOf('start')]||''),end=seconds(parts[fields.indexOf('end')]||'');
   const content=parts.slice(ti).join(',').replace(/\{[^}]*\}/g,'').replace(/\\[Nn]/g,'\n').replace(/\\h/g,' ');
   if(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&content.trim())cues.push({start,end,text:content});
  }return cues;
 }
 return text.replace(/\r/g,'').split(/\n\s*\n/).flatMap(block=>{const lines=block.split('\n'),i=lines.findIndex(l=>/\s-->\s/.test(l));if(i<0)return [];const [a,b]=lines[i].split(/\s+-->\s+/);const start=seconds(a),end=seconds(b.split(' ')[0]);return Number.isFinite(start)&&Number.isFinite(end)&&end>start?[{start,end,text:lines.slice(i+1).join('\n')}]:[];});
}
