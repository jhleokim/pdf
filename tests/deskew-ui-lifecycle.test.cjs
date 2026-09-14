const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/pro-deskew-ui.js'),'utf8');
function harness(withPage=true){
  const nodes=new Map(),documentListeners=new Map(),frames=new Map(),history=[],calls={cancel:0,schedule:0,invalidated:0},observers=[];let nextFrame=0,context;
  const document={activeElement:null,getElementById:id=>nodes.get(id)||null,querySelector:()=>null,addEventListener(type,fn){const list=documentListeners.get(type)||[];list.push(fn);documentListeners.set(type,list);}};
  function classList(){const values=new Set();return {add:name=>values.add(name),remove:name=>values.delete(name),contains:name=>values.has(name),toggle(name,on){if(on??!values.has(name))values.add(name);else values.delete(name);}};}
  document.body={classList:classList()};
  function element(id){
    const listeners=new Map(),attrs=new Map(),captures=new Set();
    const node={id,value:'0.0',checked:id==='proDeskew',disabled:false,hidden:false,width:800,height:1000,clientWidth:id==='deskewDragStrip'?300:800,clientHeight:800,style:{},options:[{text:''},{text:''}],classList:classList(),textContent:'',
      setAttribute:(key,value)=>attrs.set(key,String(value)),removeAttribute:key=>attrs.delete(key),getAttribute:key=>attrs.get(key)??null,hasAttribute:key=>attrs.has(key),
      addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},
      emit(type,props={}){const event={button:0,isPrimary:true,pointerId:1,clientX:400,clientY:100,currentTarget:node,target:node,preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){},...props};for(const fn of listeners.get(type)||[])fn(event);return event;},
      getBoundingClientRect:()=>({left:0,top:0,width:800,height:800}),getContext:()=>({drawImage(){}}),
      setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);node.emit('lostpointercapture',{pointerId:id});},
      focus(){document.activeElement=node;},blur(){document.activeElement=null;node.emit('blur');},scrollIntoView(){}};
    nodes.set(id,node);return node;
  }
  for(const id of ['proDeskewAngle','compareAfter','compareBefore','proCompare','proDeskew','deskewGhost','deskewGhostCanvas','compareStage','deskewRotateHandle','deskewDragStrip','deskewDragValue','proDeskewPageNumber','proDeskewPageMode','proDeskewMinus','proDeskewPlus','proDeskewAdjust','compareDeskewToggle','proDeskewResetPage','deskewInteraction','proDeskewPageStatus','deskewFinish'])element(id);
  const pages=withPage?[{uid:'p1',docId:'d1',srcIndex:0,rotation:0,annots:[]}]:[];
  const snapshot=()=>pages.map(p=>({uid:p.uid,deskewAngle:p.deskewAngle}));
  context=vm.createContext({document,console,pages,currentPage:pages[0]||null,proAbort:null,proMode:'pro',proPreviewOpen:true,originalHover:false,originalPinned:false,innerWidth:1200,
    livePage:()=>context.currentPage,captureEditHistory:snapshot,commitEditHistory:(before,label,key)=>history.push({before,after:snapshot(),label,key}),
    proInvalidate:()=>calls.invalidated++,syncProState:()=>context.syncDeskewControls?.(),scheduleLivePreview:()=>calls.schedule++,cancelLivePreview:()=>calls.cancel++,
    setLivePreviewOpen:open=>{context.proPreviewOpen=open;context.syncDeskewControls?.();},setStampPositioning(){},showOriginal(){},
    requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id),
    ResizeObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}}});
  vm.runInContext(source,context);
  const $=id=>nodes.get(id),seedAuto=angle=>{const value=context.deskewCallbacks(pages);value.deskewCache.set(value.deskewKeys[0],{angle:-angle});context.syncDeskewControls();};
  return {context,$,pages,history,calls,seedAuto,document,observers,frames};
}
test('empty-document initialization, reset, and returning from a deleted last page are safe',()=>{
  const h=harness(false);assert.equal(h.$('proDeskewPageNumber').value,'페이지 없음');assert.equal(h.$('proDeskewPageMode').disabled,true);
  assert.doesNotThrow(()=>{h.context.setDeskewInteraction(true);h.context.resetPageDeskewAngles();h.context.acceptDeskewPreview('missing',null);h.context.deskewPreviewFailed();});
  const page={uid:'p1',docId:'d1',srcIndex:0,rotation:0,annots:[]};h.pages.push(page);h.context.currentPage=page;h.context.syncDeskewControls();h.context.setDeskewInteraction(true);
  h.pages.length=0;h.context.currentPage=null;assert.doesNotThrow(()=>h.context.syncDeskewControls());assert.equal(h.$('deskewInteraction').hidden,true);assert.equal(h.$('proDeskewAngle').disabled,true);
});
test('opening rotation controls during auto analysis does not persist a manual zero or cancel recognition',()=>{
  const h=harness();h.$('proCompare').setAttribute('aria-busy','true');h.context.setDeskewInteraction(true);
  assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);assert.equal(h.history.length,0);assert.equal(h.calls.cancel,0);assert.equal(h.$('deskewRotateHandle').disabled,true);
  h.seedAuto(4.5);h.$('proCompare').setAttribute('aria-busy','false');h.context.syncDeskewControls();assert.equal(h.$('deskewRotateHandle').disabled,false);
  h.context.setDeskewInteraction(false);assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);
});
test('pointer rotation commits only on release, clamps to 60 degrees, and clears ghost on the finished preview',()=>{
  const h=harness();h.seedAuto(4.5);h.context.setDeskewInteraction(true);const handle=h.$('deskewRotateHandle');
  handle.emit('pointerdown');handle.emit('pointermove',{clientX:675,clientY:374});assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);assert.equal(h.context.deskewGestureActive(),true);
  handle.emit('pointerup',{clientX:675,clientY:374});assert.equal(h.pages[0].deskewAngle,60);assert.equal(h.history.length,1);assert.equal(h.history[0].before[0].deskewAngle,undefined);assert.equal(h.context.deskewGestureActive(),false);assert.equal(h.frames.size,0);assert.equal(h.$('deskewGhost').hidden,false);
  h.context.acceptDeskewPreview('p1',{mode:'manual',angle:-60,displayAngle:60});assert.equal(h.$('deskewGhost').hidden,true);assert.equal(h.$('deskewGhostCanvas').width,0);
});
test('touch cancellation and lost capture preserve automatic state without creating an undo entry',()=>{
  for(const cancel of ['pointercancel','lostpointercapture']){
    const h=harness();h.seedAuto(-2);h.context.setDeskewInteraction(true);const strip=h.$('deskewDragStrip');
    strip.emit('pointerdown',{pointerType:'touch',clientX:100});strip.emit('pointermove',{pointerType:'touch',clientX:160});strip.emit(cancel,{pointerType:'touch'});
    assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false,cancel);assert.equal(h.history.length,0,cancel);assert.equal(h.context.deskewGestureActive(),false,cancel);assert.equal(h.$('deskewGhost').hidden,true,cancel);assert.equal(h.frames.size,0,cancel);
  }
});
test('page changes cancel a drag without applying its angle to either page',()=>{
  const h=harness();h.pages.push({uid:'p2',docId:'d1',srcIndex:1,rotation:0,annots:[]});h.context.setDeskewInteraction(true);
  h.$('deskewDragStrip').emit('pointerdown',{clientX:100});h.$('deskewDragStrip').emit('pointermove',{clientX:150});h.context.currentPage=h.pages[1];h.context.syncDeskewControls();
  assert.equal(h.context.deskewGestureActive(),false);assert.equal(h.$('deskewInteraction').hidden,true);assert.equal(h.history.length,0);for(const page of h.pages)assert.equal(Object.hasOwn(page,'deskewAngle'),false);
});
test('invalid angles retain the last committed value and prevent export until corrected or escaped',()=>{
  const h=harness();h.$('proDeskewPageMode').value='manual';h.$('proDeskewPageMode').emit('change');const input=h.$('proDeskewAngle');input.focus();
  input.value='12.5';input.emit('input');assert.equal(h.pages[0].deskewAngle,12.5);
  for(const value of ['61','-61','']){input.value=value;input.emit('input');assert.equal(h.pages[0].deskewAngle,12.5);assert.equal(input.getAttribute('aria-invalid'),'true');assert.throws(()=>h.context.validateDeskewInput(),/60/);}
  input.emit('keydown',{key:'Escape'});assert.equal(input.value,'12.5');assert.equal(input.hasAttribute('aria-invalid'),false);assert.doesNotThrow(()=>h.context.validateDeskewInput());
  input.value='61';input.emit('input');h.$('proDeskewResetPage').emit('click');assert.equal(input.hasAttribute('aria-invalid'),false);assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);
});

test('a handle tap preserves the automatically measured angle and creates no manual override',()=>{
  const h=harness();h.seedAuto(3.5);h.context.setDeskewInteraction(true);const handle=h.$('deskewRotateHandle');
  handle.emit('pointerdown');handle.emit('pointerup');
  assert.equal(h.history.length,0);assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);assert.equal(h.$('deskewGhost').hidden,true);
});
