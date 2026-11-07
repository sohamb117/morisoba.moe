const menus=new WeakMap();
export function panelSettings(panel){
 if(menus.has(panel))return menus.get(panel);
 const gear=document.createElement('button'),menu=document.createElement('div');gear.type='button';gear.className='pbtn panel-settings-toggle';gear.setAttribute('aria-label',panel.getAttribute('aria-label')+' settings');gear.setAttribute('aria-expanded','false');gear.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-1 3-3 1-2 4 2 2v3l4 3 3-1 3 1 4-3v-3l2-2-2-4-3-1-1-3z"/><circle cx="12" cy="11" r="3"/></svg>';
 menu.className='panel-settings-popout';menu.setAttribute('popover','auto');menu.id=panel.id+'-settings';gear.setAttribute('aria-controls',menu.id);document.body.append(menu);panel.querySelector('.titlebar [data-window=min]').before(gear);
 gear.onclick=()=>{if(menu.matches(':popover-open')){menu.hidePopover();return;}const r=gear.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-328,r.right-320))+'px';menu.style.top=Math.min(innerHeight-100,r.bottom+6)+'px';menu.style.maxHeight=Math.max(80,innerHeight-r.bottom-20)+'px';menu.showPopover();};menu.addEventListener('toggle',()=>gear.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));
 const items=new Map(),api={menu,add(key,node){const old=items.get(key);if(old===node)return;if(old?.parentNode===menu)old.replaceWith(node);else menu.append(node);items.set(key,node);}};menus.set(panel,api);return api;
}
export function initPanelSettings(){
 const stage=document.querySelector('#stage');let scheduled=false;
 const update=()=>{scheduled=false;for(const panel of stage.querySelectorAll('.app-window')){
  for(const b of panel.querySelectorAll('.pbody button')){const text=b.textContent.trim();if(['Refresh','Connections'].includes(text)){b.classList.add('panel-settings-action');panelSettings(panel).add(b.id||text,b);}}
  const menu=menus.get(panel)?.menu;if(menu?.matches(':popover-open')&&(stage.hidden||panel.hidden))menu.hidePopover();
 }};
 new MutationObserver(()=>{if(!scheduled){scheduled=true;queueMicrotask(update);}}).observe(stage,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});update();
}
