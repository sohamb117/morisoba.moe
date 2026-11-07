import {initPanelSettings} from './panel-settings.js';
export function registerApps(container,apps){
 container.replaceChildren();
 for(const {name,launch} of apps){const button=document.createElement('button');button.textContent=name==='RemiliaNet Chat'?'remiliaNet chat':name.toLowerCase();button.onclick=()=>{container.hidden=true;document.querySelector('#launcher-toggle').setAttribute('aria-expanded','false');launch();};container.append(button);}
 document.dispatchEvent(new CustomEvent('control:apps-ready',{detail:apps}));
}
export function createDesktop({ownerId}){
 const $=s=>document.querySelector(s),launcher=$('#app-launcher'),toggle=$('#launcher-toggle'),dock=$('#dock');let top=10,offset=0;
 window.spawnDecor?.();window.attachAccessories?.(document.querySelectorAll('.app-window'));window.startCursorParallax?.();
 initPanelSettings();
 const tasks=new Map(),key='control.desktop.'+ownerId;let saved={},restoring=false,saveTimer;
 try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
 function save(){if(restoring)return;const state={};for(const win of document.querySelectorAll('.app-window'))state[win.id]={running:tasks.has(win.id),minimized:win.hidden,maximized:win.classList.contains('is-maximized'),left:win.style.left,top:win.style.top,width:win.style.width,height:win.style.height};try{localStorage.setItem(key,JSON.stringify(state));}catch{}}
 function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(save,200);}
 addEventListener('pagehide',save);addEventListener('beforeunload',save);
 new ResizeObserver(scheduleSave).observe(document.querySelector('#stage'));
 const sizes=new ResizeObserver(scheduleSave);document.querySelectorAll('.app-window').forEach(win=>{sizes.observe(win);const p=saved[win.id];if(p&&/^\d+(?:\.\d+)?px$/.test(p.width||'')){win.style.width=p.width;for(const k of ['left','top','height'])if(/^\d+(?:\.\d+)?px$/.test(p[k]||''))win.style[k]=p[k];win.style.left=Math.max(0,Math.min(parseFloat(win.style.left)||0,innerWidth-120))+'px';win.style.top=Math.max(42,Math.min(parseFloat(win.style.top)||42,innerHeight-90))+'px';win.dataset.placed='true';}if(p?.maximized)win.classList.add('is-maximized');});
 document.addEventListener('control:apps-ready',e=>{restoring=true;for(const [id,p] of Object.entries(saved)){if(!p.running)continue;const win=document.getElementById(id);if(!win)continue;const name=win.querySelector('.tl')?.textContent,app=e.detail.find(a=>a.name===name);app?.launch();if(p.minimized){win.hidden=true;tasks.get(id)?.setAttribute('aria-pressed','false');}}restoring=false;});

 function focus(win){win.style.zIndex=++top;win.style.setProperty('--window-order',top);document.querySelectorAll('.app-window').forEach(p=>p.classList.toggle('active',p===win));for(const [id,b] of tasks)b.setAttribute('aria-pressed',String(id===win.id&&!win.hidden));}
 toggle.onclick=()=>{launcher.hidden=!launcher.hidden;toggle.setAttribute('aria-expanded',String(!launcher.hidden));if(!launcher.hidden)launcher.querySelector('button')?.focus();};
 document.addEventListener('pointerdown',e=>{if(!launcher.contains(e.target)&&!toggle.contains(e.target)){launcher.hidden=true;toggle.setAttribute('aria-expanded','false');}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!launcher.hidden){launcher.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}});
 for(const win of document.querySelectorAll('.app-window')){
  win.addEventListener('pointerdown',()=>focus(win));
  const bar=win.querySelector('.titlebar');
  bar.onpointerdown=e=>{if(e.target.closest('button')||win.classList.contains('is-maximized')||innerWidth<721)return;const x=e.clientX-win.offsetLeft,y=e.clientY-win.offsetTop;bar.setPointerCapture(e.pointerId);e.preventDefault();bar.onpointermove=ev=>{win.style.left=Math.max(0,Math.min(innerWidth-120,ev.clientX-x))+'px';win.style.top=Math.max(42,Math.min(innerHeight-90,ev.clientY-y))+'px';};bar.onpointerup=()=>{bar.onpointermove=null;scheduleSave();};bar.onlostpointercapture=()=>{bar.onpointermove=null;};};
  const max=win.querySelector('[data-window=max]');max.onclick=()=>{win.classList.toggle('is-maximized');max.setAttribute('aria-pressed',String(win.classList.contains('is-maximized')));scheduleSave();};bar.ondblclick=e=>{if(!e.target.closest('button'))max.click();};
  win.querySelector('[data-window=min]').onclick=()=>{win.hidden=true;tasks.get(win.id)?.setAttribute('aria-pressed','false');scheduleSave();};
  win.querySelector('[data-window=close]').onclick=()=>{win.hidden=true;tasks.get(win.id)?.remove();tasks.delete(win.id);scheduleSave();};
 }
 addEventListener('resize',()=>{for(const win of document.querySelectorAll('.app-window')){win.style.left=Math.max(0,Math.min(parseFloat(win.style.left)||0,innerWidth-120))+'px';win.style.top=Math.max(42,Math.min(parseFloat(win.style.top)||42,innerHeight-90))+'px';}});
 return {open(id){const win=document.getElementById(id);if(!win)throw Error('Unknown app');if(!win.dataset.placed){const w=Math.min(Number(win.dataset.width),innerWidth-48);win.style.width=w+'px';win.style.left=Math.max(12,Math.min(innerWidth-w-12,(innerWidth-w)/2+offset))+'px';win.style.top=(64+offset)+'px';offset=(offset+28)%112;win.dataset.placed='true';}win.hidden=false;focus(win);if(!tasks.has(id)){const b=document.createElement('button');b.textContent=win.querySelector('.tl').textContent;b.onclick=()=>{win.hidden=false;focus(win);scheduleSave();};dock.append(b);tasks.set(id,b);}focus(win);scheduleSave();}};
}
