// Read only the Matroska metadata header. Video remains a browser-to-CDN transfer.
const decoder=new TextDecoder();
export function matroskaAudioTracks(data){
  const tracks=[];
  function vint(offset,id=false){if(offset>=data.length||data[offset]===0)return null;let mask=128,width=1;while(!(data[offset]&mask)&&width<8){mask>>=1;width++;}if(offset+width>data.length)return null;let value=id?data[offset]:data[offset]&(mask-1);for(let i=1;i<width;i++)value=value*256+data[offset+i];return {value,width};}
  function scan(start,end,entry=null,depth=0){if(depth>5)return;for(let pos=start;pos<Math.min(end,data.length);){const id=vint(pos,true);if(!id)break;const size=vint(pos+id.width);if(!size)break;const from=pos+id.width+size.width,to=Math.min(from+size.value,data.length,end);if(from>to)break;
    const value=()=>{let n=0;for(let i=from;i<to;i++)n=n*256+data[i];return n;};
    if(id.value===0xae){const track={default:true};scan(from,to,track,depth+1);if(track.type===2)tracks.push(track);}
    else if([0x18538067,0x1654ae6b].includes(id.value))scan(from,to,entry,depth+1);
    else if(entry){if(id.value===0x83)entry.type=value();if(id.value===0xd7)entry.number=value();if(id.value===0x88)entry.default=!!value();if(id.value===0x86)entry.codec=decoder.decode(data.slice(from,to));if([0x22b59c,0x22b59d].includes(id.value))entry.language=decoder.decode(data.slice(from,to));}
    if(to<=pos)break;pos=to;
  }}scan(0,data.length);return tracks;
}
export async function defaultAudio(url,transport=fetch){
  const r=await transport(url,{headers:{Range:'bytes=0-262143'},signal:AbortSignal.timeout(10000),redirect:'manual'});
  if(r.status!==206){await r.body?.cancel();return null;}
  const reader=r.body.getReader();let length=0,parts=[];try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>262144)return null;parts.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const tracks=matroskaAudioTracks(bytes);return tracks.find(t=>t.default)||tracks[0]||null;
}
