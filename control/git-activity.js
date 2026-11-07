import {panelSettings} from './panel-settings.js';
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
export function createGitActivity({api,openConnections}){
 const panel=document.querySelector('#app-git-activity'),root=document.querySelector('#git-activity-root'),summary=el('div'),graph=el('div'),stats=el('dl'),detail=el('p'),status=el('p');
 root.append(summary,graph,stats,detail,status);summary.className='git-activity-summary';graph.className='git-activity-graph';stats.className='git-activity-stats';detail.className='git-activity-detail';status.setAttribute('role','status');
 let busy=false,timer,stopped=false;
 const menu=panelSettings(panel);for(const [name,fn] of [['Refresh',()=>refresh()],['Connections',openConnections]]){const button=el('button',name.toLowerCase());button.type='button';button.className='panel-settings-action';button.onclick=fn;menu.add(name,button);}
 function render(data){
  summary.replaceChildren();const link=el('a',data.login);link.href=data.url;link.target='_blank';link.rel='noopener noreferrer';summary.append(link,el('span','past year'),el('time','updated '+new Date(data.updatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));
  graph.replaceChildren();const grid=el('div');grid.className='git-activity-grid';grid.style.gridTemplateColumns=`repeat(${data.weeks.length}, 10px)`;grid.setAttribute('role','group');grid.setAttribute('aria-label','Daily GitHub contributions over the past year');
  const levels=['NONE','FIRST_QUARTILE','SECOND_QUARTILE','THIRD_QUARTILE','FOURTH_QUARTILE'];let lastMonth='';const days=[];
  data.weeks.forEach((week,x)=>{const first=week.contributionDays[0];if(!first)return;const month=first.date.slice(0,7);if(month!==lastMonth){const label=el('span',new Date(first.date+'T12:00:00Z').toLocaleDateString('en',{month:'short',timeZone:'UTC'}).toLowerCase());label.className='git-activity-month';label.style.gridColumn=String(x+1);grid.append(label);lastMonth=month;}
   for(const day of week.contributionDays){days.push(day);const cell=el('button');cell.type='button';cell.className='git-activity-day';cell.dataset.level=String(Math.max(0,levels.indexOf(day.contributionLevel)));cell.style.gridColumn=String(x+1);cell.style.gridRow=String(day.weekday+2);const text=day.date+' · '+day.contributionCount+' contribution'+(day.contributionCount===1?'':'s');cell.title=text;cell.setAttribute('aria-label',text);cell.onfocus=cell.onpointerenter=cell.onclick=()=>{detail.textContent=text;};grid.append(cell);}
  });graph.append(grid);
  const recent=days.slice(-30).reduce((sum,d)=>sum+d.contributionCount,0),active=days.filter(d=>d.contributionCount>0).length;
  stats.replaceChildren();for(const [label,value] of [['contributions',data.total],['last 30 days',recent],['commits',data.commits],['pull requests',data.pulls],['issues',data.issues],['reviews',data.reviews],['active days',active]]){const item=el('div');item.append(el('dt',label),el('dd',Number(value).toLocaleString()));stats.append(item);}detail.textContent='';
 }
 async function refresh(){if(busy||stopped)return;busy=true;try{const data=await api('/github/activity');if(stopped)return;render(data);status.textContent='';}catch(e){status.textContent=e.message;}finally{busy=false;}}
 function poll(){clearTimeout(timer);if(stopped)return;timer=setTimeout(async()=>{if(!document.hidden&&!panel.hidden)await refresh();poll();},60000);}
 return {open:async()=>{stopped=false;await refresh();poll();},close:()=>{stopped=true;clearTimeout(timer);}};
}
