/* Approved nudges to the lower windows and candle spawn; free dragging stays intact. */
(function(){
  function adjust(){
    if(innerWidth<=720)return;
    const radio=document.getElementById('p-wave'),projects=document.getElementById('p-console'),terminal=document.getElementById('p-litany');
    if(!radio||!projects||!terminal)return;
    // L:07 keeps its original x position; its restored position sits a little lower.
    document.getElementById('p-candle').style.top=(Math.round(innerHeight*.06)+100)+'px';
    const contact=document.getElementById('p-contact'),about=document.getElementById('p-about'),work=document.getElementById('p-works'),socials=document.getElementById('p-relic');
    const radioX=Math.min(Math.round(innerWidth*.5),innerWidth-projects.offsetWidth-radio.offsetWidth-56);
    radio.style.left=Math.max(24,radioX)+'px';
    const clearsWork=radioX<work.offsetLeft+work.offsetWidth ? work.offsetTop+work.offsetHeight+24 : 0;
    radio.style.top=Math.max(clearsWork,contact.offsetTop+contact.offsetHeight+24,Math.min(Math.round(innerHeight*.68),innerHeight-radio.offsetHeight-78))+'px';
    const projectsX=Math.min(innerWidth-projects.offsetWidth-28,Math.max(Math.round(innerWidth*.715),radioX+radio.offsetWidth+28));
    projects.style.left=projectsX+'px';
    const clearsContact=projectsX<contact.offsetLeft+contact.offsetWidth ? contact.offsetTop+contact.offsetHeight+24 : 0;
    projects.style.top=Math.max(Math.round(innerHeight*.62)-32,socials.offsetTop+socials.offsetHeight+24,clearsContact)+'px';
    terminal.style.left=Math.max(24,Math.min(Math.round(innerWidth*.295),radioX-terminal.offsetWidth-28))+'px';
    terminal.style.top=Math.max(Math.round(innerHeight*.8),about.offsetTop+about.offsetHeight+24)+'px';
    if(typeof drawWires==='function')drawWires();
  }
  addEventListener('load',()=>document.fonts.ready.then(adjust));
  addEventListener('resize',adjust);
})();
