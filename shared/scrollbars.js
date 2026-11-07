/* Pixel-width scroll indicators independent of native browser scrollbar sizing. */
(() => {
 if(!HTMLElement.prototype.showPopover)return;
 const layer=document.createElement('div');layer.className='site-scroll-indicators';layer.popover='manual';layer.setAttribute('aria-hidden','true');document.body.append(layer);
 document.documentElement.classList.add('site-custom-scrollbars');
 const bars=new Map();let frame=0,needsScan=true,drag=null;
 const schedule=(scan=false)=>{needsScan ||= scan;if(!frame)frame=requestAnimationFrame(update);};
 const resize=new ResizeObserver(()=>schedule(true));resize.observe(document.body);
 function add(el){if(bars.has(el))return;const pair=['y','x'].map(axis=>{const bar=document.createElement('div');bar.className='site-scroll-indicator '+axis;bar.hidden=true;layer.append(bar);bar.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();drag={el,axis,start:axis==='y'?e.clientY:e.clientX,offset:axis==='y'?el.scrollTop:el.scrollLeft,ratio:Number(bar.dataset.ratio)};bar.setPointerCapture(e.pointerId);};bar.onpointermove=e=>{if(!drag||drag.el!==el||drag.axis!==axis)return;const value=drag.offset+((axis==='y'?e.clientY:e.clientX)-drag.start)*drag.ratio;if(axis==='y')el.scrollTop=value;else el.scrollLeft=value;};bar.onpointerup=bar.onlostpointercapture=()=>{drag=null;};bar.addEventListener('wheel',e=>{e.preventDefault();el.scrollBy({top:e.deltaY,left:e.deltaX});},{passive:false});return bar;});bars.set(el,pair);resize.observe(el);}
 function update(){frame=0;
  if(needsScan){needsScan=false;add(document.scrollingElement);for(const el of document.body.querySelectorAll('*')){if(layer.contains(el))continue;const s=getComputedStyle(el);if(/auto|scroll/.test(s.overflowX+' '+s.overflowY)&&(el.scrollHeight>el.clientHeight||el.scrollWidth>el.clientWidth))add(el);}}
  for(const [el,pair] of bars){if(!el.isConnected){pair.forEach(b=>b.remove());resize.unobserve(el);bars.delete(el);continue;}
   const viewport=el===document.scrollingElement,r=viewport?{left:0,top:0,right:innerWidth,bottom:innerHeight,width:innerWidth,height:innerHeight}:el.getBoundingClientRect(),style=getComputedStyle(el);
   for(let i=0;i<2;i++){
    const vertical=i===0,bar=pair[i],client=vertical?el.clientHeight:el.clientWidth,total=vertical?el.scrollHeight:el.scrollWidth,overflow=vertical?style.overflowY:style.overflowX;
    bar.hidden=true;if(!r.width||!r.height||total<=client+1||(!viewport&&!/auto|scroll/.test(overflow)))continue;
    const scale=viewport?1:(vertical?r.height/el.offsetHeight:r.width/el.offsetWidth)||1;
    const start=vertical?r.top+el.clientTop*scale:r.left+el.clientLeft*scale,length=client*scale,thumb=Math.max(16,length*client/total),offset=(vertical?el.scrollTop:el.scrollLeft)/(total-client)*(length-thumb);
    const edge=vertical?r.left+(el.clientLeft+el.clientWidth)*scale:r.top+(el.clientTop+el.clientHeight)*scale;
    let pos=start+offset,visibleThumb=thumb;for(let parent=el.parentElement;parent&&parent!==document.body;parent=parent.parentElement){const ps=getComputedStyle(parent);if(/auto|scroll|hidden|clip/.test(vertical?ps.overflowY:ps.overflowX)){const pr=parent.getBoundingClientRect(),lo=vertical?pr.top:pr.left,hi=vertical?pr.bottom:pr.right;const end=Math.min(pos+visibleThumb,hi);pos=Math.max(pos,lo);visibleThumb=Math.max(0,end-pos);}}if(!visibleThumb)continue;if(edge<1||edge>(vertical?innerWidth:innerHeight)||pos+thumb<0||pos>(vertical?innerHeight:innerWidth))continue;
    const x=vertical?edge-2:Math.max(0,Math.min(innerWidth-1,pos+thumb/2)),y=vertical?Math.max(0,Math.min(innerHeight-1,pos+thumb/2)):edge-2;
    const top=document.elementsFromPoint(x,y).find(n=>!layer.contains(n));if(!viewport&&top&&!el.contains(top)&&top!==el)continue;
    if(viewport&&top?.closest('dialog[open],[popover]:popover-open'))continue;
    bar.style.left=(vertical?edge-7:pos)+'px';bar.style.top=(vertical?pos:edge-7)+'px';bar.style.width=(vertical?7:visibleThumb)+'px';bar.style.height=(vertical?visibleThumb:7)+'px';bar.dataset.ratio=String((total-client)/(length-thumb));bar.hidden=false;
   }
  }
  if(!layer.matches(':popover-open'))layer.showPopover();
 }
 new MutationObserver(records=>{if(records.some(r=>!layer.contains(r.target)))schedule(true);}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','open']});
 document.addEventListener('scroll',()=>schedule(),true);document.addEventListener('input',()=>schedule(true),true);document.addEventListener('toggle',e=>{if(e.target!==layer){layer.hidePopover();schedule(true);}},true);addEventListener('resize',()=>schedule(true));document.fonts?.ready.then(()=>schedule(true));schedule(true);
})();
