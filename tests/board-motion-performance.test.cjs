const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/markup-editor.js'),'utf8');
const code=source.slice(source.indexOf('const boardMotion='),source.indexOf('function boardCardRect('));
function harness(count,{observer=true,reduced=false,visible=[500,501,502,503,504,505]}={}){
  const events=[],motions=[];let reduce=reduced;
  function element(uid,top=10000){return {
    uid,top,left:20,dy:0,dx:0,
    getBoundingClientRect(){events.push(['read',uid]);return {left:this.left+this.dx,top:this.top+this.dy,right:this.left+this.dx+100,bottom:this.top+this.dy+100,width:100,height:100};},
    animate(frames,options){events.push(['write',uid]);const values=frames[0].transform?.match(/^translate\(([-.\d]+)px,([-.\d]+)px\)$/);if(values){this.dx=Number(values[1]);this.dy=Number(values[2]);}
      const el=this,a={frames,options,active:true,cancel(){events.push(['cancel',uid]);a.active=false;el.dx=el.dy=0;}};motions.push(a);return a;
    }
  };}
  const pages=Array.from({length:count},(_,i)=>({uid:'p'+i,el:element('p'+i,visible.includes(i)?50+visible.indexOf(i)*110:10000+i*110)}));
  const context={pages,innerWidth:1200,innerHeight:800,matchMedia:()=>({matches:reduce}),...(observer?{thumbVisible:new Set(visible.map(i=>pages[i]).filter(Boolean))}:{} )};
  vm.createContext(context);vm.runInContext(code,context);
  return {context,pages,events,motions,element,reduced(value){reduce=value;},capture:()=>context.captureBoardPositions(),animate:(before,uid)=>context.animateBoardFrom(before,uid),size:()=>vm.runInContext('boardMotion.size',context)};
}

test('1000-page board measures and animates only near-visible cards after the observer resets',()=>{
  const h=harness(1000),before=h.capture();assert.equal(before.size,6);assert.equal(h.events.length,6);
  for(const p of h.pages){const top=p.el.top;p.el=h.element(p.uid,top+30);}h.context.thumbVisible.clear();h.events.length=0;
  h.animate(before);
  assert.equal(h.events.filter(e=>e[0]==='read').length,6);assert.equal(h.events.filter(e=>e[0]==='write').length,6);assert.equal(h.size(),6);
  const firstWrite=h.events.findIndex(e=>e[0]==='write');assert.ok(h.events.slice(firstWrite).every(e=>e[0]!=='read'),'Layout reads interleaved with animation writes');
});

test('new page receives entry motion only when near the viewport, independently of observer delivery',()=>{
  const h=harness(2,{visible:[0,1]}),before=h.capture();h.context.thumbVisible.clear();
  h.pages.push({uid:'added',el:h.element('added',300)});h.animate(before,'added');
  assert.equal(h.motions.length,1);assert.equal(h.motions[0].frames[0].opacity,0);
  h.pages.push({uid:'far',el:h.element('far',10000)});h.animate(h.capture(),'far');assert.equal(h.motions.length,1);
});

test('retargeting starts at the current transformed position and cancels the previous animation first',()=>{
  const h=harness(1,{visible:[0]}),p=h.pages[0];p.el.top=100;const first=h.capture();p.el.top=300;h.animate(first);
  const old=h.motions[0];p.el.dy=-100;const before=h.capture();assert.equal(before.get('p0').top,200);
  p.el.top=400;h.events.length=0;h.animate(before);
  assert.equal(old.active,false);assert.deepEqual(h.events.map(e=>e[0]),['cancel','read','write']);
  assert.equal(p.el.getBoundingClientRect().top,200);assert.equal(h.size(),1);
  old.onfinish();assert.equal(h.size(),1,'A retired animation deleted its successor');h.motions[1].onfinish();assert.equal(h.size(),0);
});

test('reduced-motion capture avoids layout reads and switching it on cancels running motion',()=>{
  const h=harness(1,{visible:[0]}),before=h.capture();h.pages[0].el.top+=30;h.animate(before);h.events.length=0;h.reduced(true);
  assert.equal(h.capture().size,0);h.animate(before);assert.equal(h.size(),0);
  assert.deepEqual(h.events.map(e=>e[0]),['cancel']);
});

test('environments without visibility observation have a bounded fallback and support small fixtures',()=>{
  const h=harness(1000,{observer:false,visible:Array.from({length:1000},(_,i)=>i)});for(const p of h.pages)p.el.top=100;
  const before=h.capture();assert.equal(before.size,80);assert.equal(h.events.length,80);
  for(const p of h.pages)p.el.top+=30;h.events.length=0;h.animate(before);assert.equal(h.motions.length,80);assert.equal(h.events.filter(e=>e[0]==='read').length,80);
  const small=harness(4,{observer:false,visible:[0,1,2,3]});assert.equal(small.capture().size,4);
});

test('stale visibility entries outside the viewport do not start animations',()=>{
  const h=harness(1000),before=h.capture();for(const page of h.context.thumbVisible)page.el.top=12000;
  h.animate(before);assert.equal(h.motions.length,0);assert.equal(h.capture().size,0);
});
