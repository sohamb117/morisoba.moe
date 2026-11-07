// Advance the existing playback queue; never replace it with a new URI list.
export async function advanceSpotifyQueue(api,{uri,index},isStopped=()=>false,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 let state=await api('/spotify/queue');
 if(!Number.isInteger(index)||index<0||index>=50||state.queue[index]?.uri!==uri)throw Error('Queue changed. Select the song again.');
 const signature=s=>JSON.stringify([s.current?.uri,s.queue.map(t=>t.uri)]);
 for(let step=0;step<=index;step++){
  if(isStopped())throw Error('Queue selection stopped.');
  if(state.queue[index-step]?.uri!==uri)throw Error('Queue changed. Select the song again.');
  const expected=state.queue[0]?.uri,before=signature(state);if(!expected)throw Error('Queue changed. Select the song again.');
  await api('/spotify/next',{});
  let advanced=false;
  for(let attempt=0;attempt<10;attempt++){
   await wait(350);if(isStopped())throw Error('Queue selection stopped.');
   const next=await api('/spotify/queue');
   if(signature(next)===before)continue;
   if(next.current?.uri!==expected)throw Error('Playback changed on another device. Select the song again.');
   state=next;advanced=true;break;
  }
  if(!advanced)throw Error('Spotify has not confirmed the skip. Refresh the queue before trying again.');
 }
 const playback=await api('/spotify/state');if(!playback.isPlaying)await api('/spotify/play',{});
}
