import {extractSubtitles} from './vendor/mkv-subtitles.js';
const seconds=value=>value.trim().replace(',','.').split(':').reduce((n,x)=>n*60+Number(x),0);
export function parseCues(text,type){
  if(type==='ass'||type==='ssa'){
    const events=text.split(/\[Events\]/i)[1]||'';
    const format=events.match(/^Format:\s*(.+)$/mi)?.[1].split(',').map(s=>s.trim().toLowerCase())||['layer','start','end','style','name','marginl','marginr','marginv','effect','text'];
    return [...events.matchAll(/^Dialogue:\s*(.+)$/gmi)].map(([,line])=>{const fields=line.split(',');const content=fields.slice(format.indexOf('text')).join(',').replace(/\{[^}]*\}/g,'').replace(/\\[Nn]/g,'\n').replace(/\\h/g,' ');return {start:seconds(fields[format.indexOf('start')]),end:seconds(fields[format.indexOf('end')]),text:content};});
  }
  return text.replace(/\r/g,'').split(/\n\s*\n/).flatMap(block=>{const lines=block.split('\n'),i=lines.findIndex(l=>l.includes(' --> '));if(i<0)return [];const [a,b]=lines[i].split(' --> ');return [{start:seconds(a),end:seconds(b.split(' ')[0]),text:lines.slice(i+1).join('\n')}];});
}
export async function attachSubtitles(video,url,signal){
  let requested=0;
  const tracks=await extractSubtitles(url,{languages:['eng','en'],concurrency:3,fetch:async(input,options)=>{
    const range=new Headers(options?.headers).get('Range')?.match(/^bytes=(\d+)-(\d+)$/);
    if(input!==url||!range||(+range[2]-+range[1])>8_000_000||(requested+=+range[2]-+range[1]+1)>80_000_000)throw new Error('Subtitle read limit');
    const response=await fetch(input,{...options,signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if(response.status!==206){await response.body?.cancel();throw new Error('Subtitle ranges unavailable');}
    return response;
  }});
  if(signal.aborted||!video.isConnected)return;
  const full=tracks.filter(t=>! /signs|songs/i.test(t.metadata.trackName||''));
  const chosen=full[0]||tracks[0];if(!chosen)throw new Error('No English subtitles');
  const track=video.addTextTrack('subtitles','English','en');
  for(const cue of parseCues(new TextDecoder().decode(chosen.output.subtitle),chosen.type))if(Number.isFinite(cue.start)&&Number.isFinite(cue.end)&&cue.end>cue.start)track.addCue(new VTTCue(cue.start,cue.end,cue.text));
  track.mode='showing';
}
