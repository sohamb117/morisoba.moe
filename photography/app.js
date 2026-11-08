'use strict';
const $=s=>document.querySelector(s);let photos=[];let album='All photographs',filtered=photos,index=0,lastFocus=null;
let albums=['All photographs'];
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function nav(){const n=$('#albums');n.replaceChildren();for(const a of albums){const b=el('button');b.type='button';b.setAttribute('aria-pressed',String(a===album));b.append(el('span','',a),el('span','',String(a===albums[0]?photos.length:photos.filter(p=>p.album===a).length).padStart(3,'0')));b.onclick=()=>{album=a;nav();render();};n.append(b);}}
function render(){const q=$('#search').value.toLowerCase().trim();filtered=photos.filter(p=>(album===albums[0]||p.album===album)&&`${p.title} ${p.album}`.toLowerCase().includes(q));$('#collection').textContent=album;$('#grid').replaceChildren();filtered.forEach((p,i)=>{const b=el('button','frame');b.setAttribute('aria-label',`View ${p.title}, ${p.album}`);const m=el('span','mount'),img=el('img');img.src=p.thumb;img.alt=p.title;img.loading=i<6?'eager':'lazy';img.decoding='async';m.append(img);const l=el('span','label');l.append(el('span','',p.title),el('span','',String(i+1).padStart(3,'0')));b.append(m,l);b.onclick=()=>{select(i);if(matchMedia('(max-width:1100px)').matches)open(i);};b.ondblclick=()=>open(i);$('#grid').append(b);});$('#empty').hidden=filtered.length>0;$('#empty').textContent=photos.length?'No matching photographs.':'Open photos or a folder to begin.';$('#shown').textContent=`${filtered.length} photos`;if(filtered.length)select(0);else{$('#detail').style.visibility='hidden';}}
function show(){const p=filtered[index];$('#large').src=p.src;$('#large').alt=`${p.title} — ${p.album}`;$('#photo-title').textContent=p.title;$('#photo-album').textContent=p.album;$('#dimensions').textContent=`${p.width} × ${p.height}`;$('#position').textContent=`${String(index+1).padStart(3,'0')} / ${filtered.length}`;$('#image-wrap').classList.remove('zoomed');$('#zoom').textContent='Zoom';$('#zoom').setAttribute('aria-pressed','false');$('#prev').disabled=index===0;$('#next').disabled=index===filtered.length-1;const strip=$('#filmstrip');strip.replaceChildren();let start=Math.max(0,Math.min(index-3,filtered.length-7));filtered.slice(start,start+7).forEach((f,j)=>{const b=el('button');b.setAttribute('aria-label',`View ${f.title}`);b.setAttribute('aria-current',String(start+j===index));const im=el('img');im.src=f.thumb;im.alt='';b.append(im);b.onclick=()=>{index=start+j;show();};strip.append(b);});history.replaceState(null,'','#'+p.id);if(filtered[index+1]){const pre=new Image();pre.src=filtered[index+1].src;}}
function select(i){index=i;const p=filtered[i];if(!p)return;$('#detail').style.visibility='';$('#preview-image').src=p.src;$('#preview-image').alt=p.title;$('#preview-title').textContent=p.title;$('#preview-album').textContent=p.album;$('#preview-size').textContent=`${p.width} × ${p.height}`;$('#preview-count').textContent=`${i+1} / ${filtered.length}`;$('#preview-prev').disabled=i===0;$('#preview-next').disabled=i===filtered.length-1;document.querySelectorAll('.frame').forEach((b,j)=>{b.classList.toggle('selected',j===i);b.setAttribute('aria-pressed',String(j===i));});}
function open(i){lastFocus=document.activeElement;index=i;show();if(!$('#viewer').open)$('#viewer').showModal();$('#close').focus();}
function close(){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});$('#viewer').close();history.replaceState(null,'',location.pathname+location.search);lastFocus?.focus();}
function move(d){const next=index+d;if(next>=0&&next<filtered.length){index=next;select(index);show();}}
$('#close').onclick=close;$('#viewer').addEventListener('cancel',e=>{e.preventDefault();close();});$('#prev').onclick=()=>move(-1);$('#next').onclick=()=>move(1);$('#search').oninput=render;$('#density').onclick=()=>{const compact=$('#grid').classList.toggle('compact');$('#density').setAttribute('aria-label',compact?'Switch to spacious grid':'Switch to compact grid');$('#density').setAttribute('aria-pressed',String(compact));$('#density').textContent=compact?'Larger grid':'Compact grid';};$('#zoom').onclick=()=>{const z=$('#image-wrap').classList.toggle('zoomed');$('#zoom').textContent=z?'Fit':'Zoom';$('#zoom').setAttribute('aria-pressed',String(z));};$('#full').hidden=!document.fullscreenEnabled;$('#full').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#viewer').requestFullscreen();}catch{ $('#full').hidden=true; }};document.addEventListener('fullscreenchange',()=>$('#full').textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen');document.addEventListener('keydown',e=>{if(!$('#viewer').open)return;if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}if(e.key==='ArrowRight'){e.preventDefault();move(1);}});let touch;$('#image-wrap').addEventListener('touchstart',e=>{touch=[e.changedTouches[0].clientX,e.changedTouches[0].clientY];},{passive:true});$('#image-wrap').addEventListener('touchend',e=>{if(!touch||$('#image-wrap').classList.contains('zoomed'))return;const dx=e.changedTouches[0].clientX-touch[0],dy=e.changedTouches[0].clientY-touch[1];if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy))move(dx<0?1:-1);touch=null;},{passive:true});$('#total').textContent=`${photos.length} photos / ${albums.length-1} collections`;nav();render();const deep=photos.findIndex(p=>p.id===location.hash.slice(1));if(deep>=0)open(deep);

$('#expand').onclick=$('#preview-open').onclick=()=>open(index);$('#preview-prev').onclick=()=>{if(index>0)select(index-1);};$('#preview-next').onclick=()=>{if(index<filtered.length-1)select(index+1);};

let localUrls=[];
async function loadLocal(fileList){
 const files=[...fileList].filter(f=>/\.(jpe?g|png|webp)$/i.test(f.name)&&!f.webkitRelativePath?.includes('__MACOSX/'));
 if(!files.length){$('#total').textContent='No supported photos selected.';return;}
 $('#files').disabled=$('#folder').disabled=true;
 const next=[],seen=new Set(),nextUrls=[];let duplicates=0,failed=0;
 try{
 for(let i=0;i<files.length;i++){
  const f=files[i];$('#total').textContent=`Opening ${i+1} / ${files.length}`;
  try{
   const bytes=await f.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);const id=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
   if(seen.has(id)){duplicates++;continue;}seen.add(id);
   const url=URL.createObjectURL(f);nextUrls.push(url);const img=new Image();img.src=url;await img.decode();
   const parts=(f.webkitRelativePath||'').split('/');const group=parts.length>2?parts[1]:parts.length>1?parts[0]:'Photos';
   next.push({id,album:group,title:f.name.replace(/\.[^.]+$/,''),width:img.naturalWidth,height:img.naturalHeight,src:url,thumb:url});
  }catch{failed++;}
 }
 localUrls.forEach(u=>URL.revokeObjectURL(u));localUrls=nextUrls;photos=next;album='All photographs';albums=[album,...new Set(photos.map(p=>p.album))];$('#search').value='';nav();render();
 $('#total').textContent=`${photos.length} photos / ${albums.length-1} collections`+(duplicates?` · ${duplicates} duplicates skipped`:'')+(failed?` · ${failed} unreadable`:'');
 }finally{$('#files').disabled=$('#folder').disabled=false;$('#files').value=$('#folder').value='';}
}
$('#files').onchange=e=>loadLocal(e.target.files);$('#folder').onchange=e=>loadLocal(e.target.files);
window.addEventListener('beforeunload',()=>localUrls.forEach(u=>URL.revokeObjectURL(u)));
