export function registerApps(container,apps){
 container.replaceChildren();
 for(const {name,launch} of apps){const button=document.createElement('button');button.textContent=name;button.onclick=()=>{container.hidden=true;document.querySelector('#launcher-toggle').setAttribute('aria-expanded','false');launch();};container.append(button);}
}
export function createDesktop(){
 const $=s=>document.querySelector(s),launcher=$('#app-launcher'),toggle=$('#launcher-toggle'),dock=$('#dock');let top=10,offset=0;
 window.spawnDecor?.();window.attachAccessories?.(document.querySelectorAll('.app-window'));window.startCursorParallax?.();
 const tasks=new Map();
 function focus(win){win.style.zIndex=++top;win.style.setProperty('--window-order',top);document.querySelectorAll('.app-window').forEach(p=>p.classList.toggle('active',p===win));for(const [id,b] of tasks)b.setAttribute('aria-pressed',String(id===win.id&&!win.hidden));}
 toggle.onclick=()=>{launcher.hidden=!launcher.hidden;toggle.setAttribute('aria-expanded',String(!launcher.hidden));if(!launcher.hidden)launcher.querySelector('button')?.focus();};
 document.addEventListener('pointerdown',e=>{if(!launcher.contains(e.target)&&!toggle.contains(e.target)){launcher.hidden=true;toggle.setAttribute('aria-expanded','false');}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!launcher.hidden){launcher.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}});
 for(const win of document.querySelectorAll('.app-window')){
  win.addEventListener('pointerdown',()=>focus(win));
  const bar=win.querySelector('.titlebar');
  bar.onpointerdown=e=>{if(e.target.closest('button')||win.classList.contains('is-maximized')||innerWidth<721)return;const x=e.clientX-win.offsetLeft,y=e.clientY-win.offsetTop;bar.setPointerCapture(e.pointerId);e.preventDefault();bar.onpointermove=ev=>{win.style.left=Math.max(0,Math.min(innerWidth-120,ev.clientX-x))+'px';win.style.top=Math.max(42,Math.min(innerHeight-90,ev.clientY-y))+'px';};bar.onpointerup=()=>{bar.onpointermove=null;};bar.onlostpointercapture=()=>{bar.onpointermove=null;};};
  const max=win.querySelector('[data-window=max]');max.onclick=()=>{win.classList.toggle('is-maximized');max.setAttribute('aria-pressed',String(win.classList.contains('is-maximized')));};bar.ondblclick=e=>{if(!e.target.closest('button'))max.click();};
  win.querySelector('[data-window=min]').onclick=()=>{win.hidden=true;tasks.get(win.id)?.setAttribute('aria-pressed','false');};
  win.querySelector('[data-window=close]').onclick=()=>{win.hidden=true;tasks.get(win.id)?.remove();tasks.delete(win.id);};
 }
 addEventListener('resize',()=>{for(const win of document.querySelectorAll('.app-window')){win.style.left=Math.max(0,Math.min(parseFloat(win.style.left)||0,innerWidth-120))+'px';win.style.top=Math.max(42,Math.min(parseFloat(win.style.top)||42,innerHeight-90))+'px';}});
 return {open(id){const win=document.getElementById(id);if(!win)throw Error('Unknown app');if(!win.dataset.placed){const w=Math.min(Number(win.dataset.width),innerWidth-48);win.style.width=w+'px';win.style.left=Math.max(12,Math.min(innerWidth-w-12,(innerWidth-w)/2+offset))+'px';win.style.top=(64+offset)+'px';offset=(offset+28)%112;win.dataset.placed='true';}win.hidden=false;focus(win);if(!tasks.has(id)){const b=document.createElement('button');b.textContent=win.querySelector('.tl').textContent;b.onclick=()=>{win.hidden=false;focus(win);};dock.append(b);tasks.set(id,b);}focus(win);}};
}
