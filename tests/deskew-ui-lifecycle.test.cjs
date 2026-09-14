const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/pro-deskew-ui.js'),'utf8');
function harness(withPage=true){
  const nodes=new Map(),documentListeners=new Map(),frames=new Map(),history=[],calls={cancel:0,schedule:0,invalidated:0},observers=[];let nextFrame=0,context;
  const document={activeElement:null,getElementById:id=>nodes.get(id)||null,querySelector:()=>null,addEventListener(type,fn){const list=documentListeners.get(type)||[];list.push(fn);documentListeners.set(type,list);},emit(type,props={}){const event={target:document.activeElement,preventDefault(){},stopImmediatePropagation(){},...props};for(const fn of documentListeners.get(type)||[])fn(event);return event;}};
  function classList(){const values=new Set();return {add:name=>values.add(name),remove:name=>values.delete(name),contains:name=>values.has(name),toggle(name,on){if(on??!values.has(name))values.add(name);else values.delete(name);}};}
  document.body={classList:classList()};
  function element(id){
    const listeners=new Map(),attrs=new Map(),captures=new Set();
    const node={id,value:'0.0',checked:id==='proDeskew',disabled:false,hidden:false,width:800,height:1000,clientWidth:id==='deskewDragStrip'?300:id==='deskewPreviewArea'?780:800,clientHeight:id==='deskewPreviewArea'?650:800,offsetHeight:id==='deskewDock'?100:800,
      rect:id==='compareAfter'?{left:100,top:80,width:400,height:500}:id==='deskewPreviewArea'?{left:10,top:20,width:780,height:650}:{left:0,top:0,width:800,height:800},
      style:{setProperty(key,value){this[key]=String(value);},getPropertyValue(key){return this[key]||'';}},options:[{text:''},{text:''}],classList:classList(),textContent:'',
      setAttribute:(key,value)=>attrs.set(key,String(value)),removeAttribute:key=>attrs.delete(key),getAttribute:key=>attrs.get(key)??null,hasAttribute:key=>attrs.has(key),
      addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},
      emit(type,props={}){const event={button:0,isPrimary:true,pointerId:1,clientX:400,clientY:100,currentTarget:node,target:node,preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){},...props};for(const fn of listeners.get(type)||[])fn(event);return event;},
      getBoundingClientRect:()=>({...node.rect,right:node.rect.left+node.rect.width,bottom:node.rect.top+node.rect.height}),getContext:()=>({drawImage(){}}),
      setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);node.emit('lostpointercapture',{pointerId:id});},
      focus(){document.activeElement=node;},blur(){document.activeElement=null;node.emit('blur');},scrollIntoView(){}};
    nodes.set(id,node);return node;
  }
  for(const id of ['proDeskewAngle','compareAfter','compareBefore','proCompare','proDeskew','deskewGhost','deskewGhostCanvas','compareStage','deskewDragStrip','proDeskewPageNumber','proDeskewPageMode','proDeskewMinus','proDeskewPlus','proDeskewAdjust','compareDeskewToggle','proDeskewResetPage','deskewInteraction','proDeskewPageStatus','deskewFinish','deskewDialAngle','deskewDock','deskewPreviewArea','deskewCropMask','deskewGuides','deskewGhostPaper','deskewRulerTrack','deskewCropHint','deskewDialMinus','deskewDialPlus','deskewDialReset','deskewDialAuto','deskewCropCorners','compareAfterScroll'])element(id);
  const pages=withPage?[{uid:'p1',docId:'d1',srcIndex:0,rotation:0,annots:[]}]:[];
  const snapshot=()=>pages.map(p=>({uid:p.uid,deskewAngle:p.deskewAngle,deskewCrop:p.deskewCrop}));
  context=vm.createContext({document,console,pages,currentPage:pages[0]||null,proAbort:null,proMode:'pro',proPreviewOpen:true,originalHover:false,originalPinned:false,innerWidth:1200,
    livePage:()=>context.currentPage,captureEditHistory:snapshot,commitEditHistory:(before,label,key)=>{const after=snapshot();if(JSON.stringify(before)!==JSON.stringify(after))history.push({before,after,label,key});},
    proInvalidate:()=>calls.invalidated++,syncProState:()=>context.syncDeskewControls?.(),scheduleLivePreview:()=>calls.schedule++,cancelLivePreview:()=>calls.cancel++,
    setLivePreviewOpen:open=>{context.proPreviewOpen=open;context.syncDeskewControls?.();},setStampPositioning(){},showOriginal(){},
    requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id),
    ResizeObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}}});
  vm.runInContext(source,context);
  const $=id=>nodes.get(id),seedAuto=angle=>{const value=context.deskewCallbacks(pages);value.deskewCache.set(value.deskewKeys[0],{angle:-angle});context.syncDeskewControls();};
  return {context,$,pages,history,calls,seedAuto,document,observers,frames,flushFrames(){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();}};
}
test('empty-document initialization, reset, and returning from a deleted last page are safe',()=>{
  const h=harness(false);assert.equal(h.$('proDeskewPageNumber').value,'페이지 없음');assert.equal(h.$('proDeskewPageMode').disabled,true);
  assert.doesNotThrow(()=>{h.context.setDeskewInteraction(true);h.context.resetPageDeskewAngles();h.context.acceptDeskewPreview('missing',null);h.context.deskewPreviewFailed();});
  const page={uid:'p1',docId:'d1',srcIndex:0,rotation:0,annots:[]};h.pages.push(page);h.context.currentPage=page;h.context.syncDeskewControls();h.context.setDeskewInteraction(true);
  h.pages.length=0;h.context.currentPage=null;assert.doesNotThrow(()=>h.context.syncDeskewControls());assert.equal(h.$('deskewInteraction').hidden,true);assert.equal(h.$('proDeskewAngle').disabled,true);
});
test('opening rotation controls during auto analysis does not persist a manual zero or cancel recognition',()=>{
  const h=harness();h.$('proCompare').setAttribute('aria-busy','true');h.context.setDeskewInteraction(true);
  assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);assert.equal(h.history.length,0);assert.equal(h.calls.cancel,0);assert.equal(h.$('deskewDragStrip').getAttribute('aria-disabled'),'true');
  h.seedAuto(4.5);h.$('proCompare').setAttribute('aria-busy','false');h.context.syncDeskewControls();assert.equal(h.$('deskewDragStrip').getAttribute('aria-disabled'),'false');
  h.context.setDeskewInteraction(false);assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);
});
test('ruler dragging commits only on release, clamps to 60 degrees, and clears ghost on the finished preview',()=>{
  const h=harness();h.seedAuto(4.5);h.context.setDeskewInteraction(true);const handle=h.$('deskewDragStrip');
  handle.emit('pointerdown',{clientX:400});handle.emit('pointermove',{clientX:-300});assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);assert.equal(h.context.deskewGestureActive(),true);
  handle.emit('pointerup',{clientX:-300});assert.equal(h.pages[0].deskewAngle,60);assert.equal(h.history.length,1);assert.equal(h.history[0].before[0].deskewAngle,undefined);assert.equal(h.context.deskewGestureActive(),false);assert.equal(h.frames.size,0);assert.equal(h.$('deskewGhost').hidden,false);
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
for(const id of ['proDeskewAngle','deskewDialAngle'])test(`${id} rejects invalid input and blocks finish until corrected or escaped`,()=>{
  const h=harness();h.$('proDeskewPageMode').value='manual';h.$('proDeskewPageMode').emit('change');h.context.setDeskewInteraction(true);const input=h.$(id);input.focus();
  input.value='12.5';input.emit('input');assert.equal(h.pages[0].deskewAngle,12.5);
  for(const value of ['61','-61','']){input.value=value;input.emit('input');assert.equal(h.pages[0].deskewAngle,12.5);assert.equal(input.getAttribute('aria-invalid'),'true');assert.throws(()=>h.context.validateDeskewInput(),/60/);}
  h.$('deskewFinish').emit('click');assert.equal(h.$('deskewInteraction').hidden,false);assert.equal(h.document.activeElement,input);
  input.emit('keydown',{key:'Escape'});assert.equal(input.value,'12.5');assert.equal(input.hasAttribute('aria-invalid'),false);assert.doesNotThrow(()=>h.context.validateDeskewInput());
  input.value='61';input.emit('input');h.$('proDeskewResetPage').emit('click');assert.equal(input.hasAttribute('aria-invalid'),false);assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);
});

test('a ruler tap preserves the automatically measured angle and creates no manual override',()=>{
  const h=harness();h.seedAuto(3.5);h.context.setDeskewInteraction(true);const handle=h.$('deskewDragStrip');
  handle.emit('pointerdown');handle.emit('pointerup');
  assert.equal(h.history.length,0);assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);assert.equal(h.$('deskewGhost').hidden,true);
});

test('ruler movement follows the finger and escape cancels only the gesture without an undo entry',()=>{
  const h=harness();h.seedAuto(3.5);h.context.setDeskewInteraction(true);const strip=h.$('deskewDragStrip');strip.focus();
  strip.emit('pointerdown',{clientX:200});strip.emit('pointermove',{clientX:202});assert.equal(h.frames.size,0);
  strip.emit('pointermove',{clientX:240});h.flushFrames();
  assert.equal(h.$('deskewDialAngle').value,'-0.5');assert.equal(h.$('deskewRulerTrack').style.transform,'translateX(5px)');assert.equal(h.pages[0].deskewAngle,undefined);
  h.document.emit('keydown',{key:'Escape',target:strip});assert.equal(h.context.deskewGestureActive(),false);assert.equal(h.history.length,0);assert.equal(h.$('deskewInteraction').hidden,false);assert.equal(h.$('deskewGhost').hidden,true);
});

test('dial reset writes a manual zero while staying open and auto restores the measured angle',()=>{
  const h=harness();h.seedAuto(4);h.context.setDeskewInteraction(true);
  h.$('deskewDialPlus').emit('click');assert.equal(h.pages[0].deskewAngle,4.1);assert.equal(h.$('proDeskewAngle').value,'4.1');
  h.$('deskewDialMinus').emit('click');assert.equal(h.pages[0].deskewAngle,4);
  h.$('deskewDialReset').emit('click');assert.equal(h.pages[0].deskewAngle,0);assert.equal(h.$('deskewInteraction').hidden,false);assert.equal(h.$('deskewDialAngle').value,'0.0');
  const last=h.history.at(-1);assert.equal(last.before[0].deskewAngle,4);assert.equal(last.after[0].deskewAngle,0);
  h.$('deskewDialAuto').emit('click');assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);assert.equal(h.$('deskewDialAngle').value,'4.0');assert.equal(h.$('deskewDialAuto').getAttribute('aria-pressed'),'true');assert.equal(h.$('deskewInteraction').hidden,false);
});

test('crop checkbox preserves angles and measurement cache while recording reversible page preferences',()=>{
  const h=harness();h.seedAuto(3.5);h.context.setDeskewInteraction(true);const initial=h.context.deskewCallbacks(h.pages).deskewKeys[0],check=h.$('deskewCropCorners');
  assert.equal(check.checked,false);assert.equal(Object.hasOwn(h.pages[0],'deskewCrop'),false);
  check.checked=true;check.emit('change');assert.equal(h.pages[0].deskewCrop,true);assert.equal(h.pages[0].deskewAngle,undefined);assert.equal(h.context.deskewCallbacks(h.pages).deskewKeys[0],initial);assert.match(h.$('deskewCropHint').textContent,/제외/);
  const changed=h.history.at(-1);assert.equal(changed.before[0].deskewCrop,undefined);assert.equal(changed.after[0].deskewCrop,true);
  const strip=h.$('deskewDragStrip');strip.emit('pointerdown',{clientX:200});assert.equal(h.$('deskewCropMask').hidden,false);strip.emit('pointercancel');assert.equal(h.$('deskewCropMask').hidden,true);assert.equal(h.pages[0].deskewCrop,true);
  check.checked=false;check.emit('change');assert.equal(Object.hasOwn(h.pages[0],'deskewCrop'),false);assert.match(h.$('deskewCropHint').textContent,/페이지를 자르지 않습니다/);assert.equal(h.context.deskewCallbacks(h.pages).deskewKeys[0],initial);
  assert.equal(h.history.at(-1).before[0].deskewCrop,true);assert.equal(h.history.at(-1).after[0].deskewCrop,undefined);
});

test('page change preserves each existing manual angle and crop setting while cancelling transient movement',()=>{
  const h=harness();h.pages[0].deskewAngle=6;h.pages[0].deskewCrop=true;h.pages.push({uid:'p2',docId:'d1',srcIndex:1,rotation:0,annots:[],deskewAngle:-4,deskewCrop:false});h.context.setDeskewInteraction(true);
  h.$('deskewDragStrip').emit('pointerdown',{clientX:100});h.$('deskewDragStrip').emit('pointermove',{clientX:150});h.context.currentPage=h.pages[1];h.context.syncDeskewControls();
  assert.equal(h.context.deskewGestureActive(),false);assert.equal(h.$('deskewInteraction').hidden,true);assert.equal(h.history.length,0);
  assert.equal(h.pages[0].deskewAngle,6);assert.equal(h.pages[0].deskewCrop,true);assert.equal(h.pages[1].deskewAngle,-4);assert.equal(h.pages[1].deskewCrop,false);assert.equal(h.$('deskewCropCorners').checked,false);assert.equal(h.$('deskewDialAngle').value,'-4.0');
});

test('preview guides track the visible canvas and reserve the dock without changing document state',()=>{
  const h=harness();h.context.setDeskewInteraction(true);const guides=h.$('deskewGuides');
  assert.equal(h.$('compareStage').style.getPropertyValue('--deskew-dock-height'),'100px');
  assert.equal(guides.style.left,'90px');assert.equal(guides.style.top,'60px');assert.equal(guides.style.width,'400px');assert.equal(guides.style.height,'500px');
  h.$('compareAfter').rect.top=120;h.$('compareAfterScroll').emit('scroll');assert.equal(guides.style.top,'100px');
  h.$('deskewDock').offsetHeight=140;h.observers[1].callback();assert.equal(h.$('compareStage').style.getPropertyValue('--deskew-dock-height'),'140px');
  assert.equal(h.history.length,0);assert.equal(Object.hasOwn(h.pages[0],'deskewAngle'),false);
  h.context.setDeskewInteraction(false);assert.equal(guides.hidden,true);assert.equal(h.$('compareStage').style.getPropertyValue('--deskew-dock-height'),'0px');
});

test('closing the dial externally discards only its invalid draft and keeps the last valid document angle',()=>{
  for(const mode of ['tool','preview','basic','escape','programmatic-tool','programmatic-preview','programmatic-basic']){
    const h=harness();h.context.setDeskewInteraction(true);const input=h.$('deskewDialAngle');input.focus();input.value='12.5';input.emit('input');
    const historyCount=h.history.length;input.value='61';input.emit('input');assert.throws(()=>h.context.validateDeskewInput(),/60/,mode);
    // Programmatic layout/mode changes can close the editor while its field still has focus.
    const action=mode.replace('programmatic-',''),outside=h.$(action==='escape'?'deskewDragStrip':'compareDeskewToggle');
    if(!mode.startsWith('programmatic-'))outside.focus();else assert.equal(h.document.activeElement,input,mode);
    if(action==='tool')h.context.setDeskewInteraction(false);
    else if(action==='preview'){h.context.proPreviewOpen=false;h.context.syncDeskewControls();}
    else if(action==='basic'){h.context.proMode='basic';h.context.syncDeskewControls();}
    else h.document.emit('keydown',{key:'Escape',target:outside});
    assert.equal(h.$('deskewInteraction').hidden,true,mode);assert.equal(input.hasAttribute('aria-invalid'),false,mode);assert.equal(input.value,'12.5',mode);
    assert.doesNotThrow(()=>h.context.validateDeskewInput(),mode);assert.equal(h.pages[0].deskewAngle,12.5,mode);assert.equal(h.history.length,historyCount,mode);
    h.context.proMode='pro';h.context.proPreviewOpen=true;h.context.setDeskewInteraction(true);assert.equal(input.value,'12.5',mode);assert.equal(h.history.length,historyCount,mode);
  }
});

test('closing the dial does not dismiss invalid input in the separate page-settings form',()=>{
  for(const mode of ['tool','preview','basic','escape']){
    const h=harness();h.$('proDeskewPageMode').value='manual';h.$('proDeskewPageMode').emit('change');h.context.setDeskewInteraction(true);
    const input=h.$('proDeskewAngle');input.focus();input.value='12.5';input.emit('input');const historyCount=h.history.length;input.value='61';input.emit('input');
    const outside=h.$(mode==='escape'?'deskewDragStrip':'compareDeskewToggle');outside.focus();
    if(mode==='tool')h.context.setDeskewInteraction(false);
    else if(mode==='preview'){h.context.proPreviewOpen=false;h.context.syncDeskewControls();}
    else if(mode==='basic'){h.context.proMode='basic';h.context.syncDeskewControls();}
    else h.document.emit('keydown',{key:'Escape',target:outside});
    assert.equal(h.$('deskewInteraction').hidden,true,mode);assert.equal(input.getAttribute('aria-invalid'),'true',mode);assert.equal(input.value,'61',mode);
    assert.throws(()=>h.context.validateDeskewInput(),/60/,mode);assert.equal(h.document.activeElement,input,mode);assert.equal(h.pages[0].deskewAngle,12.5,mode);assert.equal(h.history.length,historyCount,mode);
  }
});
