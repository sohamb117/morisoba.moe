/* ============================================================
   Shared chrome for morisoba.moe
   Extracted from index.html; keep byte-for-byte behavior where possible.
   ============================================================ */

var W = function(){return window.innerWidth;};
var H = function(){return window.innerHeight;};
function isMobile(){return window.matchMedia("(max-width:720px)").matches;}
var chromePanels = {};
var chromeWires = [];
var chromeFloor = [];
var chromeDrops = [];
var zTop=100;

function panelHash(id){
  var h=0; for(var i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))&0xFFFF;
  return h;
}
function ledStripHTML(id){
  var seed=panelHash(id);
  var n=3+(seed%3);
  var blink=seed%n;
  var out="";
  for(var k=0;k<n;k++){
    var v=(seed+k*13)%12;
    var cls="led";
    if(v<2) cls+=" warn";
    else if(v<4) cls+=" hi";
    else if(v<9) cls+=" on";
    if(k===blink){
      cls+=" blink";
      if((seed>>3)%2) cls+=" slow";
    }
    out+='<i class="'+cls+'"></i>';
  }
  return '<span class="led-strip">'+out+'</span>';
}
function serialHex(id){
  return ("0000"+panelHash(id).toString(16).toUpperCase()).slice(-4);
}
function barcodeSVG(seed){
  var s=seed, bars="", x=0;
  for(var i=0;i<11;i++){
    s=(s*1103515245+12345)&0x7FFFFFFF;
    var bw=1+(s%3), gap=1+((s>>4)%2);
    bars+='<rect x="'+x+'" y="0" width="'+bw+'" height="8"/>';
    x+=bw+gap;
  }
  return '<svg viewBox="0 0 '+x+' 8" preserveAspectRatio="xMidYMid meet">'+bars+'</svg>';
}


function applyPanelLayout(LAYOUT, MAT){
  var panels = {};
  chromePanels = panels;
  (LAYOUT || []).forEach(function(row){
    var el = document.getElementById(row[0]);
    panels[row[0]] = el;
    var w = parseInt(el.getAttribute("data-w"),10)||280;
    if(!isMobile()){
      el.style.width = w+"px";
      el.style.left = Math.round(row[1]*W())+"px";
      el.style.top  = Math.round(row[2]*H())+"px";
    }
    var mat = MAT[row[0]];
    if(mat) mat.split(" ").forEach(function(c){el.classList.add(c);});
  });
  setupPanelManager(panels);
  return panels;
}

function attachAccessories(panelsCollection){
  var list = Array.prototype.slice.call(panelsCollection || []);
  list.forEach(function(el){
    var id=el.id;
    var tb=el.querySelector(".titlebar");
    if(tb && !tb.querySelector(".led-strip")){
      var firstBtn=tb.querySelector(".pbtn");
      var wrap=document.createElement("span");
      wrap.innerHTML=ledStripHTML(id);
      var strip=wrap.firstChild;
      if(firstBtn) tb.insertBefore(strip,firstBtn); else tb.appendChild(strip);
    }
    var body=el.querySelector(".pbody");
    if(body && !body.querySelector(".asset-tag")){
      var s=serialHex(id);
      var bc=barcodeSVG(panelHash(id)*7+91);
      body.insertAdjacentHTML("beforeend",
        '<span class="asset-tag">'+bc+'<span>MRSB·A'+s+'</span></span>');
    }
  });
}

/* ================= wires ================= */
function pt(el, side){
  var x=el.offsetLeft,y=el.offsetTop,w=el.offsetWidth,h=el.offsetHeight;
  switch(side){
    case "left":return [x,y+h/2,-1,0];
    case "right":return [x+w,y+h/2,1,0];
    case "top":return [x+w/2,y,0,-1];
    case "bottom":return [x+w/2,y+h,0,1];
  }
}
/* deterministic pseudo-random so cables keep their shape while dragging */
function rnd(i){var x=Math.sin(i*127.1+13.7)*43758.5453;return x-Math.floor(x);}
/* slack catenary-ish cable between two points */
function sagCtl(ax,ay,bx,by,sag,seed){
  var w1=(rnd(seed)-.5)*44, w2=(rnd(seed+1)-.5)*44;
  var s1=sag*(0.8+0.5*rnd(seed+2)), s2=sag*(0.8+0.5*rnd(seed+3));
  return [ax+(bx-ax)/3+w1, ay+(by-ay)/3+s1,
          ax+2*(bx-ax)/3+w2, ay+2*(by-ay)/3+s2];
}
function sagPath(ax,ay,bx,by,sag,seed){
  var c=sagCtl(ax,ay,bx,by,sag,seed);
  return "M"+Math.round(ax)+" "+Math.round(ay)+
    " C "+Math.round(c[0])+" "+Math.round(c[1])+
    ", "+Math.round(c[2])+" "+Math.round(c[3])+
    ", "+Math.round(bx)+" "+Math.round(by);
}
/* point along the same cable, for bindings/clips */
function sagPt(ax,ay,bx,by,sag,seed,t){
  var c=sagCtl(ax,ay,bx,by,sag,seed);
  var u=1-t;
  var x=u*u*u*ax+3*u*u*t*c[0]+3*u*t*t*c[2]+t*t*t*bx;
  var y=u*u*u*ay+3*u*u*t*c[1]+3*u*t*t*c[3]+t*t*t*by;
  return [Math.round(x),Math.round(y)];
}
function visible(el){return el.style.display!=="none";}
/* pick a monochrome tone deterministically; bias toward mid/lo to feel worn */
function pickTone(seed){
  var r=rnd(seed);
  if(r<0.15) return "t-hi";
  if(r<0.50) return "t-mid";
  if(r<0.80) return "t-lo";
  return "t-faint";
}
function drawWires(LAYOUT, WIRES, FLOOR, DROPS){
  if(isMobile()) return;
  if(WIRES) chromeWires=WIRES;
  if(FLOOR) chromeFloor=FLOOR;
  if(DROPS) chromeDrops=DROPS;
  WIRES=chromeWires; FLOOR=chromeFloor; DROPS=chromeDrops;
  var panels=chromePanels;
  var svg = document.getElementById("wires");
  if(!svg) return;
  svg.setAttribute("viewBox","0 0 "+W()+" "+H());
  var out="";
  /* slack cable bundles between panels */
  WIRES.forEach(function(wr,i){
    var ea=panels[wr[0]], eb=panels[wr[2]];
    if(!visible(ea)||!visible(eb)) return;
    var a=pt(ea,wr[1]), b=pt(eb,wr[3]);
    var dist=Math.sqrt((b[0]-a[0])*(b[0]-a[0])+(b[1]-a[1])*(b[1]-a[1]));
    var strands=4+Math.floor(rnd(i+50)*5);
    var tone=pickTone(i+55);
    for(var k=0;k<strands;k++){
      var off=(k-(strands-1)/2)*3;
      var sag=16+dist*0.15*(1+rnd(i*7+k)*0.9);
      var d=sagPath(a[0]+off,a[1],b[0]+off,b[1],sag,i*31+k*7);
      out+='<path class="'+(k===0?'cable':'cable2')+' '+tone+'" d="'+d+'"/>';
      if(k===0&&i%3===0) out+='<path class="flow" d="'+d+'"/>';
      /* bindings taping the bundle together */
      if(k===0){
        [0.32,0.62].forEach(function(t,bi2){
          if(rnd(i*5+bi2)<.6){
            var bp=sagPt(a[0]+off,a[1],b[0]+off,b[1],sag,i*31+k*7,t);
            out+='<rect class="port" x="'+(bp[0]-2)+'" y="'+(bp[1]-4)+'" width="5" height="9"/>';
          }
        });
      }
    }
    out+='<rect class="port" x="'+(a[0]-3)+'" y="'+(a[1]-3)+'" width="6" height="6"/>';
    out+='<rect class="port" x="'+(b[0]-3)+'" y="'+(b[1]-3)+'" width="6" height="6"/>';
  });
  /* cables dropping from the top of the screen */
  DROPS.forEach(function(dp,i){
    var el=panels[dp[1]];
    if(!visible(el)) return;
    var tx=dp[0]*W(), ty=25;
    var px=el.offsetLeft+el.offsetWidth*(0.15+0.7*rnd(i+200));
    var py=el.offsetTop;
    var d=sagPath(tx,ty,px,py,24+56*rnd(i+300),i*13+500);
    var tone=pickTone(i+250);
    out+='<path class="cable '+tone+'" style="opacity:.55" d="'+d+'"/>';
    if(i%2===1){
      var d2=sagPath(tx+4,ty,px+4,py,30+56*rnd(i+310),i*17+900);
      out+='<path class="cable2 '+tone+'" d="'+d2+'"/>';
    }
    out+='<circle class="via" cx="'+Math.round(tx)+'" cy="'+ty+'" r="2"/>';
    out+='<rect class="port" x="'+(px-3)+'" y="'+(py-3)+'" width="6" height="6"/>';
  });
  /* cables running down to the floor */
  FLOOR.forEach(function(fl,i){
    var el=panels[fl[0]];
    if(!visible(el)) return;
    var px=el.offsetLeft+el.offsetWidth*fl[1];
    var py=el.offsetTop+el.offsetHeight;
    var bx=px+(rnd(i+700)-.5)*260;
    var d=sagPath(px,py,bx,H()-26,10+34*rnd(i+710),i*19+720);
    var tone=pickTone(i+750);
    out+='<path class="cable '+tone+'" style="opacity:.45" d="'+d+'"/>';
    out+='<circle class="via" cx="'+Math.round(bx)+'" cy="'+(H()-26)+'" r="2"/>';
  });
  /* limp dead cables hanging off every panel */
  Object.keys(panels).forEach(function(id,k){
    var el=panels[id];
    if(!visible(el)) return;
    var x=el.offsetLeft,y=el.offsetTop,w=el.offsetWidth,h=el.offsetHeight;
    for(var j=0;j<5;j++){
      var sx=x+w*(0.12+0.72*rnd(k*9+j));
      var sy=y+h;
      var len=26+80*rnd(k*5+j+40);
      var ex=sx+(rnd(k*3+j+80)-.5)*110;
      var ey=sy+len;
      var d="M"+Math.round(sx)+" "+Math.round(sy)+
        " C "+Math.round(sx+(rnd(k+j+7)-.5)*20)+" "+Math.round(sy+len*.65)+
        ", "+Math.round(ex)+" "+Math.round(ey-len*.35)+
        ", "+Math.round(ex)+" "+Math.round(ey);
      out+='<path class="dead" d="'+d+'"/>';
      if(j===1){
        /* electrode pad on this loose end */
        out+='<circle class="dead-end" cx="'+Math.round(ex)+'" cy="'+Math.round(ey)+'" r="4.5"/>';
        out+='<circle class="via" cx="'+Math.round(ex)+'" cy="'+Math.round(ey)+'" r="1.5"/>';
      }else{
        out+='<circle class="dead-end" cx="'+Math.round(ex)+'" cy="'+Math.round(ey)+'" r="2.5"/>';
      }
    }
  });
  svg.innerHTML=out;
}

/* ================= background traces (static) ================= */
function drawTraces(){
  if(isMobile()) return;
  var traces=document.getElementById("traces");
  if(!traces) return;
  traces.setAttribute("viewBox","0 0 "+W()+" "+H());
  var g=32, out="";
  var TR="#8a8a8c"; /* in-wall trace tone — steel/dust */
  function snap(v){return Math.round(v/g)*g;}
  /* long slack wire spans crossing the whole screen */
  for(var sp=0;sp<16;sp++){
    var y1=H()*(0.06+0.88*Math.random());
    var y2=y1+(Math.random()-.5)*H()*0.35;
    var sag=30+Math.random()*140;
    var c1y=y1+(y2-y1)/3+sag, c2y=y1+2*(y2-y1)/3+sag;
    var dd="M0 "+Math.round(y1)+" C "+Math.round(W()/3)+" "+Math.round(c1y)+
      ", "+Math.round(2*W()/3)+" "+Math.round(c2y)+", "+W()+" "+Math.round(y2);
    var oo=(.06+Math.random()*.10).toFixed(2);
    out+='<path d="'+dd+'" fill="none" stroke="'+TR+'" stroke-width="1" opacity="'+oo+'"/>';
    if(sp%3===0){
      var dd2="M0 "+Math.round(y1+5)+" C "+Math.round(W()/3)+" "+Math.round(c1y+14)+
        ", "+Math.round(2*W()/3)+" "+Math.round(c2y+9)+", "+W()+" "+Math.round(y2+4);
      out+='<path d="'+dd2+'" fill="none" stroke="'+TR+'" stroke-width="1" opacity="'+oo+'"/>';
    }
  }
  for(var i=0;i<30;i++){
    var x=snap(Math.random()*W()), y=snap(Math.random()*H());
    var d="M"+x+" "+y, horiz=Math.random()<.5;
    var segs=2+Math.floor(Math.random()*4);
    for(var s=0;s<segs;s++){
      var len=g*(1+Math.floor(Math.random()*5));
      if(Math.random()<.5) len=-len;
      if(horiz){x=Math.max(0,Math.min(W(),x+len));}
      else{y=Math.max(0,Math.min(H(),y+len));}
      d+=" L"+x+" "+y; horiz=!horiz;
    }
    var op=(.06+Math.random()*.11).toFixed(2);
    out+='<path d="'+d+'" fill="none" stroke="'+TR+'" stroke-width="1" opacity="'+op+'"/>';
    out+='<rect x="'+(x-2)+'" y="'+(y-2)+'" width="4" height="4" fill="'+TR+'" opacity="'+op+'"/>';
  }
  for(var v=0;v<90;v++){
    out+='<circle cx="'+snap(Math.random()*W())+'" cy="'+snap(Math.random()*H())+
      '" r="1.4" fill="'+TR+'" opacity="'+(.04+Math.random()*.09).toFixed(2)+'"/>';
  }
  traces.innerHTML=out;
}

/* ================= scattered texture: tech glyphs, sparse crosses ================= */
function spawnDecor(config){
  if(isMobile()) return;
  config = config || {};
  var decor=document.getElementById("decor");
  var crosses=config.CROSSES || ["✠","†","☩","♰","✝","☨","✞","♱"];
  var techGlyphs=config.GLYPHS || ["▓","▒","░","▚","▞","▓▒░","░▒▓","[XX]","<NUL>","0x1F","0x2A","0x77","0xEA","0x00","0xFF","::","▓▒","▚▞","·─·","0xCF01","0x2A4F","IRQ:07","MASK","EOF","ACK","NAK","RETRY","CHK","0x00A1"];
  var out="";
  for(var i=0;i<6;i++){
    var gl=crosses[Math.floor(Math.random()*crosses.length)];
    var fs=(10+Math.random()*22).toFixed(0);
    var op=(.04+Math.random()*.06).toFixed(2);
    out+='<span class="bg-cross" style="left:'+(Math.random()*94).toFixed(1)+
      '%;top:'+(Math.random()*92).toFixed(1)+'%;font-size:'+fs+'px;opacity:'+op+'">'+gl+'</span>';
  }
  for(var g=0;g<32;g++){
    var tg=techGlyphs[Math.floor(Math.random()*techGlyphs.length)];
    var fs2=(7+Math.random()*4).toFixed(0);
    var op2=(.06+Math.random()*.10).toFixed(2);
    out+='<span class="bg-cross" style="left:'+(Math.random()*94).toFixed(1)+
      '%;top:'+(Math.random()*92).toFixed(1)+'%;font-size:'+fs2+'px;opacity:'+op2+
      ';letter-spacing:2px">'+tg+'</span>';
  }
  var texRow="▓▒░ ▚▞ ░▒▓ ▞▚ ";
  for(var t=0;t<3;t++){
    var block="";
    for(var r=0;r<6;r++){block+=texRow.repeat(4)+"\n";}
    out+='<div class="fill-tex" style="left:'+(Math.random()*70).toFixed(0)+
      '%;top:'+(Math.random()*80).toFixed(0)+'%">'+block+'</div>';
  }
  for(var gw=0;gw<16;gw++){
    var wgt=(90+Math.random()*280).toFixed(0);
    var hgt=(50+Math.random()*190).toFixed(0);
    out+='<div class="ghost-win'+(Math.random()<.3?' lit':'')+
      '" style="left:'+(Math.random()*85).toFixed(1)+'%;top:'+(Math.random()*80).toFixed(1)+
      '%;width:'+wgt+'px;height:'+hgt+'px"></div>';
  }
  var CODE=config.CODE || [
    "void reset_panel(u_int level);",
    "if(level < MAX_LAYER){",
    "coord_init(&object[PANEL]);",
    "load_model(&s_long_&kids_tmd);",
    "imprint the memory into the consciousness.",
    "rewrite the record.",
    "the thing you don't remember\nis the thing that didn't happen.",
    "protocol_7 :: init_g_pass()",
    "object[LAYER]->world.coord[2] = 0;",
    "DrawSync(0);  // 被験者の意識",
    "new_panel_set(i, 0, 4);",
    "soham will guide you.",
    "close the world, open the next.",
    "BGdly = BG_LINE_Y + move_cyc;"
  ];
  for(var cf=0;cf<24;cf++){
    var frag=CODE[cf%CODE.length];
    var rot=Math.random()<.22?"transform:rotate(90deg);":"";
    var fs3=(8+Math.random()*3).toFixed(0);
    var op3=(.08+Math.random()*.11).toFixed(2);
    out+='<div class="code-tex" style="left:'+(Math.random()*82).toFixed(1)+
      '%;top:'+(Math.random()*88).toFixed(1)+'%;font-size:'+fs3+'px;opacity:'+op3+';'+rot+'">'+frag+'</div>';
  }
  decor.innerHTML=out;
}



/* ================= drag ================= */
function bringTop(el){zTop++;el.style.zIndex=zTop;}
function setupPanelManager(panels){
Object.keys(panels).forEach(function(id){
  var el=panels[id];
  var bar=el.querySelector(".titlebar");
  el.addEventListener("pointerdown",function(){bringTop(el);});
  bar.addEventListener("pointerdown",function(e){
    if(e.target.classList.contains("pbtn")||isMobile())return;
    e.preventDefault();bringTop(el);el.classList.add("dragging");
    var sx=e.clientX-el.offsetLeft, sy=e.clientY-el.offsetTop;
    function mv(ev){
      el.style.left=Math.max(-el.offsetWidth+50,Math.min(ev.clientX-sx,W()-50))+"px";
      el.style.top=Math.max(24,Math.min(ev.clientY-sy,H()-40))+"px";
      drawWires();
    }
    function up(){
      el.classList.remove("dragging");
      window.removeEventListener("pointermove",mv);
      window.removeEventListener("pointerup",up);
      drawWires();
    }
    window.addEventListener("pointermove",mv);
    window.addEventListener("pointerup",up);
  });
});

/* ================= min / close / dock ================= */
var dock=document.getElementById("dock");
document.querySelectorAll(".pbtn").forEach(function(btn){
  btn.addEventListener("click",function(e){
    e.stopPropagation();
    var el=btn.closest(".panel");
    if(btn.getAttribute("data-act")==="min"){
      el.classList.toggle("min");drawWires();
    }else{
      el.style.display="none";
      var b=document.createElement("button");
      b.textContent=el.querySelector(".tl").textContent;
      b.addEventListener("click",function(){
        el.style.display="";dock.removeChild(b);bringTop(el);drawWires();
      });
      dock.appendChild(b);drawWires();
    }
  });
});


}

/* ================= cursor + traces parallax (rAF + lerp) ================= */
function startCursorParallax(){
var cur=document.getElementById("cursor");
if(cur&&!isMobile()){
  var tracesEl=document.getElementById("traces");
  var pxT={x:0,y:0}, pxC={x:0,y:0}, pxRunning=false;
  function pxFrame(){
    pxC.x += (pxT.x - pxC.x) * 0.10;
    pxC.y += (pxT.y - pxC.y) * 0.10;
    if(tracesEl) tracesEl.style.transform="translate3d("+pxC.x.toFixed(2)+"px,"+pxC.y.toFixed(2)+"px,0)";
    if(Math.abs(pxT.x-pxC.x)>0.05||Math.abs(pxT.y-pxC.y)>0.05){
      requestAnimationFrame(pxFrame);
    } else {
      pxRunning=false;
    }
  }
  window.addEventListener("pointermove",function(e){
    cur.style.left=e.clientX+"px";cur.style.top=e.clientY+"px";
    pxT.x=(e.clientX/W()-0.5)*7;
    pxT.y=(e.clientY/H()-0.5)*5;
    if(!pxRunning){pxRunning=true;requestAnimationFrame(pxFrame);}
  });
  document.addEventListener("pointerover",function(e){
    if(e.target.closest("a,button,.titlebar"))cur.classList.add("hot");
    else cur.classList.remove("hot");
  });
}


}

/* ================= glitch corruption: religious residue as data drift ================= */
var glitchSelectors=[".tl"];
function registerGlitchTargets(selectors){
  (selectors||[]).forEach(function(sel){if(glitchSelectors.indexOf(sel)<0)glitchSelectors.push(sel);});
}
(function(){
  var CROSS=["✠","†","☩","♰","✝","☨","✞","♱"];
  function tick(){
    var targets=document.querySelectorAll(glitchSelectors.join(", "));
    if(targets.length){
      var el=targets[Math.floor(Math.random()*targets.length)];
      var txt=el.textContent;
      if(txt&&txt.length>=3){
        var pos=-1, tries=0;
        while(tries++<20){
          var p=Math.floor(Math.random()*txt.length);
          var ch=txt[p];
          if(ch!==" "&&ch!=="\n"&&ch!=="\t"&&ch!=="✠"&&ch!=="†"){pos=p;break;}
        }
        if(pos>=0){
          var g=CROSS[Math.floor(Math.random()*CROSS.length)];
          el.textContent=txt.slice(0,pos)+g+txt.slice(pos+1);
          el.classList.add("glitching");
          setTimeout(function(){
            if(el.textContent.length===txt.length) el.textContent=txt;
            el.classList.remove("glitching");
          },90+Math.random()*90);
        }
      }
    }
    setTimeout(tick,3000+Math.random()*5000);
  }
  setTimeout(tick,6000);
})();



/* ================= packet-loss RGB tear (rare) ================= */
function startPacketBurst(){
  if(isMobile()) return;
  function burst(){
    var b=document.createElement("div");
    b.className="packet-burst";
    var wRatio=0.30+Math.random()*0.40;
    b.style.width=(W()*wRatio).toFixed(0)+"px";
    b.style.left=(Math.random()*(W()-W()*wRatio)).toFixed(0)+"px";
    b.style.top=(24+Math.random()*(H()-72)).toFixed(0)+"px";
    document.body.appendChild(b);
    setTimeout(function(){if(b.parentNode) b.parentNode.removeChild(b);},260);
    setTimeout(burst,15000+Math.random()*22000);
  }
  setTimeout(burst,12000+Math.random()*8000);
}



function startLoader(BOOT, onDone){
var hexEl=document.getElementById("hexdump");
var bootI=0;
var hexTimer=setInterval(function(){
  if(bootI<BOOT.length){
    hexEl.innerHTML=BOOT.slice(Math.max(0,bootI-2),bootI+1).join("<br>");
    bootI++;
  }
},120);
var bar=document.querySelector("#loadbar i");
var pct=document.getElementById("loadpct");
var p=0;
var loadTimer=setInterval(function(){
  p+=4+Math.random()*10;
  if(p>=100){p=100;clearInterval(loadTimer);clearInterval(hexTimer);finishLoad();}
  bar.style.width=p+"%";
  pct.textContent=("00"+Math.floor(p)).slice(-3)+"%";
},60);
function finishLoad(){
  hexEl.innerHTML="close the world, open the next.";
  setTimeout(function(){
    document.getElementById("loader").classList.add("done");
    var panels=chromePanels;
    var order=Object.keys(panels);
    order.forEach(function(id,i){
      setTimeout(function(){panels[id].classList.add("booted");drawWires();},40*i);
    });
    setTimeout(function(){
      drawWires();
      if(typeof onDone==="function") {
        Promise.resolve(onDone()).catch(function(err){
          console.error("startLoader onDone rejected:", err);
        });
      }
    },40*order.length+180);
  },420);
}


}

function initChrome(){
  window.addEventListener("resize",function(){drawTraces();drawWires();});
  startPacketBurst();
  startCursorParallax();
}

// T2a will replace stubs with real implementations.
function markdownToHtml(md) {
  md = md.replace(/\r\n/g, "\n");
  const blocks = [];
  md = md.replace(/^```(.*)\n([\s\S]*?)^```/gm, (m, lang, code) => {
    const trimmedLang = lang.trim();
    const safeLang = trimmedLang.match(/^[a-z0-9_-]{1,32}$/i) ? trimmedLang : "";
    blocks.push(`<pre><code${safeLang ? ` data-lang="${safeLang}"` : ""}>${sanitizeHtml(code)}</code></pre>`);
    return `__BLOCK_${blocks.length - 1}__`;
  });
  const paragraphs = md.split(/\n\n+/);
  return paragraphs.map(p => {
    p = p.trim();
    if (!p) return "";
    if (p.startsWith("__BLOCK_")) return blocks[parseInt(p.match(/\d+/)[0])];
    const hMatch = p.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) return `<h${hMatch[1].length}>${parseInline(hMatch[2])}</h${hMatch[1].length}>`;
    if (p.startsWith("> ")) return `<blockquote>${parseInline(p.split('\n').map(l => l.replace(/^>\s?/, "")).join('\n'))}</blockquote>`;
    if (p === "---") return "<hr>";
    if (/^[-*]\s/m.test(p)) {
      const items = p.split('\n').filter(l => l.trim());
      if (items.every(l => l.match(/^[-*]\s/))) return `<ul>\n${items.map(l => `<li>${parseInline(l.replace(/^[-*]\s/, ""))}</li>`).join("\n")}\n</ul>`;
    }
    if (/^\d+\.\s/m.test(p)) {
      const items = p.split('\n').filter(l => l.trim());
      if (items.every(l => l.match(/^\d+\.\s/))) return `<ol>\n${items.map(l => `<li>${parseInline(l.replace(/^\d+\.\s/, ""))}</li>`).join("\n")}\n</ol>`;
    }
    return `<p>${parseInline(p)}</p>`;
  }).join("\n");
  
  function parseInline(text) {
    text = sanitizeHtml(text).replace(/  \n/g, "<br>");
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*(?!\*)(.+?)\*(?!\*)/g, "<em>$1</em>");
    text = text.replace(/_(?!_)(.+?)_(?!_)/g, "<em>$1</em>");
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(/\[([^\]]+)\]\(((?:[^)(]+|\([^)(]*\))+)\)/g, (m, label, url) => {
      const rawUrl = url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (/^(javascript|data|file|vbscript):/i.test(rawUrl) || !/^(https?:\/\/|mailto:|\/|\.\/|\.\.\/|#)/i.test(rawUrl)) return label;
      return `<a href="${url}">${label}</a>`;
    });
    return text.replace(/&lt;(https?:\/\/[^&]+)&gt;/g, '<a href="$1">$1</a>');
  }
}
function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { frontmatter: {}, content: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, content: text };
  const fmText = text.substring(4, end), content = text.substring(end + 4).replace(/^\n/, "");
  const frontmatter = {}, lines = fmText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("-")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.substring(0, colon).trim(), val = line.substring(colon + 1).trim();
    if (val.startsWith("[")) {
      frontmatter[key] = val.replace(/^\[|\]$/g, "").split(",").map(s => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    } else if (val === "") {
      const arr = [];
      while (i + 1 < lines.length && lines[i+1].trim().startsWith("- ")) arr.push(lines[++i].trim().substring(2).trim().replace(/^['"]|['"]$/g, ""));
      frontmatter[key] = arr.length > 0 ? arr : val;
    } else {
      if (val === "true") frontmatter[key] = true;
      else if (val === "false") frontmatter[key] = false;
      else if (/^['"].*['"]$/.test(val)) frontmatter[key] = val.substring(1, val.length - 1);
      else frontmatter[key] = val;
    }
  }
  return { frontmatter, content };
}
function sanitizeHtml(html) {
  if (typeof html !== "string") return "";
  return html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function latLonToXY(lat, lon, W, H) {
  lat = Math.max(-90, Math.min(90, lat));
  lon = Math.max(-180, Math.min(180, lon));
  return { x: ((lon + 180) / 360) * W, y: ((90 - lat) / 180) * H };
}
