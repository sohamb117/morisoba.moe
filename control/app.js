'use strict';
const services=[
 {id:'calendar',title:'Calendar',description:'Booking pages, availability, bookings & password',url:'/book/admin/?panel=1'},
 {id:'members',title:'Community',description:'Invitations, members & moderation',url:'/mimorigasaka/?panel=1#admin-tools'},
 {id:'mimori',title:'Mimori',description:'Account, invitations, identity & keyring',url:'/mimori/?panel=1#account'}
];
const panels={directory:document.querySelector('#directory')};
for(const service of services){
 const panel=document.createElement('section');panel.id=service.id;panel.className='panel booted mat-crt service';panel.dataset.w='760';panel.setAttribute('aria-label',service.title);
 const bar=document.createElement('div');bar.className='titlebar';const title=document.createElement('span');title.className='tl';title.textContent=service.title;bar.append(title);
 for(const [act,label,symbol] of [['min','Minimize','−'],['close','Close','×']]){const b=document.createElement('button');b.className='pbtn';b.dataset.act=act;b.setAttribute('aria-label',label+' '+service.title);b.textContent=symbol;bar.append(b);}
 const body=document.createElement('div');body.className='pbody';const link=document.createElement('a');link.className='panel-link';link.href=service.url;link.target='_blank';link.rel='noopener';link.textContent='Open '+service.title+' in a separate tab ↗';
 const frame=document.createElement('iframe');frame.title=service.title+' administration';frame.dataset.src=service.url;frame.loading='lazy';frame.src=service.url;body.append(link,frame);panel.append(bar,body);document.querySelector('#stage').append(panel);panels[service.id]=panel;
 const launch=document.createElement('button');launch.className='launch';const name=document.createElement('span');name.textContent=service.title;const detail=document.createElement('small');detail.textContent=service.description;launch.append(name,detail);launch.onclick=()=>open(service.id);document.querySelector('#launchers').append(launch);
}
const layout=[['directory',.025,.12],['calendar',.27,.14],['members',.31,.18],['mimori',.35,.22]];
applyPanelLayout(layout,{});attachAccessories(Object.values(panels));
const wires=services.map(s=>['directory','right',s.id,'left']);
function arrange(){for(const [id,x,y] of layout){const p=panels[id];p.classList.remove('is-maximized');p.style.left=Math.min(Math.round(x*innerWidth),Math.max(16,innerWidth-p.offsetWidth-16))+'px';p.style.top=Math.round(y*innerHeight)+'px';}drawWires(null,wires,[],[]);}
function open(id){const panel=panels[id];if(!panel||id==='directory')return;const dockButton=[...document.querySelectorAll('#dock button')].find(b=>b.textContent===panel.querySelector('.tl').textContent);dockButton?.click();panel.classList.remove('min');const frame=panel.querySelector('iframe');if(!frame.hasAttribute('src'))frame.src=frame.dataset.src;bringTop(panel);panel.querySelector('.titlebar button').focus({preventScroll:true});if(isMobile())panel.scrollIntoView({behavior:'smooth',block:'start'});history.replaceState(null,'','#'+id);drawWires();}
// Add maximize after the shared manager registers its min/close controls.
for(const s of services){const p=panels[s.id],bar=p.querySelector('.titlebar');const b=document.createElement('button');b.className='expand';b.textContent='□';b.setAttribute('aria-label','Maximize '+s.title);b.setAttribute('aria-pressed','false');const toggle=()=>{p.classList.toggle('is-maximized');p.classList.remove('min');b.setAttribute('aria-pressed',String(p.classList.contains('is-maximized')));bringTop(p);drawWires();};b.onclick=toggle;b.onpointerdown=e=>e.stopPropagation();bar.insertBefore(b,bar.querySelector('.pbtn'));bar.ondblclick=e=>{if(!e.target.closest('button'))toggle();};p.querySelector('[data-act=close]').click();}
arrange();document.querySelector('#arrange').onclick=arrange;addEventListener('resize',arrange);addEventListener('hashchange',()=>open(location.hash.slice(1)));if(services.some(s=>s.id===location.hash.slice(1)))open(location.hash.slice(1));
