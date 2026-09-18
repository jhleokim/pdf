const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/privacy-ui.js'),'utf8');
function harness(){
 const elements=new Map(),pages=[{uid:1,annots:[]},{uid:2,annots:[]}];let buildFailure=false,renderFailure=false,holdBuild=null,sourceFailure=null,builds=0;
 function element(id=''){
  const node={id,width:0,height:0,children:[],style:{},dataset:{},listeners:{},classList:{toggle(){}},
   addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(){},replaceChildren(){this.children=[];},append(child){this.children.push(child);},
   getBoundingClientRect:()=>({left:0,top:0,width:400,height:600}),setPointerCapture(){},getContext:()=>({}),
   replaceWith(next){elements.set(this.id,next);},click(){if(!this.disabled)this.onclick?.();}};
  return node;
 }
 const $=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
 const context=vm.createContext({$,pages,docs:new Map(),proAbort:null,SVGNS:'svg',annoUidSeq:0,DOC_OPTS:{},
  document:{createElement:()=>element(),createElementNS:()=>element()},
  PDFPrivacy:{clearCache(){},assertSupportedSources:async()=>{if(sourceFailure)throw sourceFailure;}},captureEditHistory:()=>({}),commitEditHistory(){},proInvalidate(){},renderAnnots(){},toolsChanged(){},syncCounts(){},
  buildEditedDocument:async list=>{builds++;if(holdBuild)await holdBuild;if(buildFailure)throw Error('unreadable page');return {save:async()=>list[0].uid};},
  pdfjsLib:{getDocument:()=>({destroy:async()=>{},promise:Promise.resolve({getPage:async()=>({
   getViewport:()=>({width:400,height:600}),render:()=>({cancel(){},promise:renderFailure?Promise.reject(Error('render failure')):Promise.resolve()})
  })})})}});
 vm.runInContext(source,context);
 function draw(){const target=$('privacyOverlay'),event={button:0,clientX:40,clientY:60,pointerId:1,target:{dataset:{}},preventDefault(){}};
  target.listeners.pointerdown(event);target.listeners.pointermove({...event,clientX:200,clientY:300});target.listeners.pointerup(event);
 }
 return {$,pages,draw,show:index=>context.showPrivacyPage(pages[index]),failBuild:value=>buildFailure=value,failRender:value=>renderFailure=value,holdBuild:value=>holdBuild=value,failSource:value=>sourceFailure=value,get builds(){return builds;}};
}

for(const failure of ['build','render'])test('failed '+failure+' after page navigation cannot put masks on a page different from the displayed image',async()=>{
 const h=harness();await h.show(0);assert.equal(h.$('privacyCanvas').width,400);
 h[failure==='build'?'failBuild':'failRender'](true);await h.show(1);
 assert.equal(h.$('privacyCanvas').width,0,'The previous page image is cleared after switching pages');
 assert.equal(h.$('privacyOverlay').style.pointerEvents,'none','A failed page remains non-interactive');
 h.draw();assert.equal(h.pages[1].annots.length,0,'Masks cannot be created against an unrendered page');
 h[failure==='build'?'failBuild':'failRender'](false);await h.show(1);h.draw();
 assert.equal(h.pages[1].annots.length,1,'A successful retry restores drawing');assert.equal(h.pages[0].annots.length,0);
});

test('loading or closing the privacy dialog keeps an unrendered page non-interactive',async()=>{
 const h=harness();await h.show(0);let release;h.holdBuild(new Promise(resolve=>release=resolve));const pending=h.show(1);
 assert.equal(h.$('privacyCanvas').width,0);h.draw();assert.equal(h.pages[1].annots.length,0);
 release();await pending;h.draw();assert.equal(h.pages[1].annots.length,1);
 h.$('privacyDialog').listeners.close();h.draw();assert.equal(h.pages[1].annots.length,1,'Closing the dialog disables drawing');
});

test('optional-layer rejection happens before building the masking-editor page and shows the actionable error',async()=>{
 const h=harness();await h.show(0);const before=h.builds,message='레이어 표시 설정이 있는 PDF는 필요한 레이어만 포함하여 다시 저장해 주세요.';
 h.failSource(Object.assign(Error(message),{code:'PRIVACY_OPTIONAL_CONTENT'}));await h.show(1);
 assert.equal(h.builds,before);assert.equal(h.$('privacyEditStatus').textContent,message);assert.equal(h.$('privacyCanvas').width,0);
 h.draw();assert.equal(h.pages[1].annots.length,0);
});
