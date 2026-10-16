/* Pure beat-envelope functions. A beat grid drives rhythm, not audio samples. */
(function(root) {
  'use strict';
  function previous(values, time) {
    let low=0, high=values.length-1, found=-1;
    while(low<=high) { const mid=(low+high)>>1; if(values[mid]<=time){found=mid;low=mid+1;}else high=mid-1; }
    return found<0 ? null : values[found];
  }
  function pulse(values,time,decay) {const beat=previous(values,time);return beat===null?0:Math.exp(-(time-beat)/decay);}
  function profile(analysis) {
    const f=analysis?.features || {};
    const energy=f.energy ?? .45, acoustic=f.acousticness ?? .4, dance=f.danceability ?? .5;
    const style=acoustic>.65?'acoustic':energy>.75?'intense':dance>.7?'rhythmic':'soft';
    return {tempo:f.tempo || 100,energy,style,roughness:style==='intense'?.7:style==='acoustic'?.12:.3};
  }
  function amplitude(analysis,time) {
    const p=profile(analysis);
    if(analysis?.mode==='beatgrid') return .15 + .65*pulse(analysis.beats,time,.11) + .2*pulse(analysis.downbeats,time,.2);
    const period=60/p.tempo;
    return .2 + .8*Math.exp(-((time%period)/period)*7);
  }
  function points(analysis,time,active) {
    const p=profile(analysis), envelope=amplitude(analysis,time);
    let result='';
    for(let x=0;x<=220;x+=2){
      const taper=Math.sin(Math.PI*x/220)**.6;
      const wave=Math.sin(x*.11-time*5.4)+p.roughness*Math.sin(x*.37+time*11)+.2*Math.sin(x*.07-time*2);
      const y=active?32+wave*taper*(3+12*p.energy)*envelope:32;
      result+=x+','+y.toFixed(1)+' ';
    }
    return result;
  }
  const api={previous,profile,amplitude,points};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.SpotifyVisualizer=api;
})(typeof window!=='undefined'?window:globalThis);
