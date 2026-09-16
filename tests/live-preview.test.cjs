const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../src/pro-live-preview.js'),'utf8');
function harness(){
 const elements=new Map(), published=[];let release;
 const classList=()=>{const values=new Set();return {contains:name=>values.has(name),add:(...names)=>names.forEach(name=>values.add(name)),remove:(...names)=>names.forEach(name=>values.delete(name)),toggle(name,force){const on=force===undefined?!values.has(name):!!force;if(on)values.add(name);else values.delete(name);return on;}};};
 const element=id=>{
  if(!elements.has(id))elements.set(id,{id,value:'1',clientWidth:500,clientHeight:600,attrs:{},classList:classList(),
   setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]||'';},removeAttribute(k){delete this.attrs[k];},
   addEventListener(){},querySelector(){return element(id+'-summary');},focus(){},replaceWith(canvas){published.push(id);elements.set(id,canvas);}});
  return elements.get(id);
 };
 let processing=0;
 const report={changed:1,skipped:0,imageCount:1,notes:[]};
 const doc=()=>({save:async()=>new Uint8Array([1,2,3])});
 const c=vm.createContext({AbortController,DOMException,console,Number,JSON,Promise,setTimeout,clearTimeout,
  $:element,proReady:true,proMode:'pro',proAbort:null,proResult:null,proControlIds:[],pages:[{uid:'p1'}],previewUid:'p1',selected:()=>[],
  proFingerprint:()=>'',isMobile:()=>false,setProView(){},devicePixelRatio:1,ResizeObserver:class{observe(){}},
  document:{body:{classList:classList()},addEventListener(){},createElement(){return {style:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]||'';},getContext(){return {};},replaceWith(canvas){published.push(this.id);elements.set(this.id,canvas);}};}},
  requestAnimationFrame:fn=>fn(),showPreview(){},readProOptions:()=>({grayscale:true}),buildEditedDocument:async()=>doc(),
  PDFLib:{PDFDocument:{load:async()=>doc()}},PDFPro:{processDocument:async()=>{if(processing++===0)await new Promise(r=>release=r);return report;}},
  PDFProDocument:{applyDocument:async()=>{}},PDFDeskew:{processDocument:async()=>({changed:0,pages:[]})},describeProSettings:()=>'test',verifyProText:async(a,b,signal,quiet)=>assert.equal(quiet,true),DOC_OPTS:{},
  pdfjsLib:{getDocument:()=>({promise:Promise.resolve({getPage:async()=>({getViewport:({scale})=>({width:100*scale,height:200*scale}),render:()=>({promise:Promise.resolve()})}),destroy:async()=>{}})})}
 });
 c.PDFProPipeline={apply:async(d,o,cb)=>{await c.PDFDeskew.processDocument(d,o,cb);const r=await c.PDFPro.processDocument(d,o,cb);await c.PDFProDocument.applyDocument(d,o,cb);return {doc:d,report:{...r,deskew:{changed:0,pages:[]}}};}};
 vm.runInContext(code+'\nliveHadPages=true;',c);
 return {c,element,published,release:()=>release(),isWaiting:()=>!!release,processing:()=>processing};
}
test('a superseded preview never publishes stale canvases and the newer result succeeds',async()=>{
 const h=harness();const first=vm.runInContext('updateLivePreview(0)',h.c);
 for(let n=0;!h.isWaiting();n++){if(n>10000)throw Error('Preview never reached processing: '+h.element('compareNote').textContent);await new Promise(r=>setImmediate(r));}
 vm.runInContext('cancelLivePreview()',h.c);h.release();await first;
 assert.deepEqual(h.published,[]);
 await vm.runInContext('updateLivePreview(1)',h.c);
 assert.deepEqual(h.published,['compareBefore','compareAfter']);
 assert.equal(h.element('compareState').textContent,'미리보기 업데이트 완료');
 assert.equal(h.element('compareOriginal').disabled,false);
});

test('zoom and viewport resizing reuse the processed PDF; document edits invalidate it',async()=>{
 const h=harness(),first=vm.runInContext('updateLivePreview(0)',h.c);
 for(let n=0;!h.isWaiting();n++){if(n>10000)throw Error('Preview never reached processing: '+h.element('compareNote').textContent);await new Promise(r=>setImmediate(r));}h.release();await first;
 h.element('compareZoom').value='2';h.element('compareStage').clientWidth=800;
 await vm.runInContext('updateLivePreview(0)',h.c);
 assert.equal(h.processing(),1,'Display changes must not reapply PDF transformations');
 assert.equal(h.published.length,4,'Both canvases redraw from the cached documents');
 h.c.proFingerprint=()=>'edited';await vm.runInContext('updateLivePreview(0)',h.c);
 assert.equal(h.processing(),2,'Document edits must regenerate the transformed PDF');
 vm.runInContext('setLivePreviewOpen(false)',h.c);
 assert.equal(vm.runInContext('liveCache===null&&liveDocs.length===0',h.c),true,'Closing releases cached document references');
});
test('closing a preview cancels in-flight work without publishing an obsolete result',async()=>{
 const h=harness();const job=vm.runInContext('updateLivePreview(0)',h.c);
 for(let n=0;!h.isWaiting();n++){if(n>10000)throw Error('Preview never reached processing: '+h.element('compareNote').textContent);await new Promise(r=>setImmediate(r));}
 vm.runInContext('setLivePreviewOpen(false)',h.c);h.release();await job;
 assert.deepEqual(h.published,[]);assert.equal(h.element('proCompare').hidden,true);
 assert.equal(h.element('proPreviewLabel').textContent,'페이지 미리보기');
});

test('deskew temporarily fits the page at zoom one, follows available height, then restores the saved zoom without PDF processing',async()=>{
 const h=harness();h.element('compareZoom').value='2';const first=vm.runInContext('updateLivePreview(0)',h.c);
 for(let n=0;!h.isWaiting();n++){if(n>10000)throw Error('Preview never reached processing: '+h.element('compareNote').textContent);await new Promise(r=>setImmediate(r));}h.release();await first;
 assert.equal(h.element('compareAfter').style.width,'560px');assert.equal(h.element('compareAfter').style.height,'1120px');
 const body=h.c.document.body.classList;body.add('deskew-adjusting');
 await vm.runInContext('updateLivePreview(0)',h.c);
 assert.equal(h.element('compareZoom').value,'2','The user zoom choice must not be overwritten');
 assert.equal(h.element('compareAfter').style.width,'280px');assert.equal(h.element('compareAfter').style.height,'560px');
 assert.equal(h.processing(),1,'Opening the dial only redraws cached PDFs');
 const key=vm.runInContext('liveKey()',h.c),contentKey=vm.runInContext('liveContentKey()',h.c),slot=h.element('compareAfterScroll');slot.clientHeight=400;
 assert.notEqual(vm.runInContext('liveKey()',h.c),key,'Dock height affects the render key even when the outer stage size is unchanged');
 assert.equal(vm.runInContext('liveContentKey()',h.c),contentKey);
 await vm.runInContext('updateLivePreview(0)',h.c);
 assert.equal(h.element('compareAfter').style.width,'180px');assert.equal(h.element('compareAfter').style.height,'360px');assert.equal(h.processing(),1);
 slot.clientHeight=600;body.remove('deskew-adjusting');await vm.runInContext('updateLivePreview(0)',h.c);
 assert.equal(h.element('compareZoom').value,'2');assert.equal(h.element('compareAfter').style.width,'560px');assert.equal(h.element('compareAfter').style.height,'1120px');
 assert.equal(h.processing(),1,'Closing the dial also reuses the processed PDF');assert.equal(h.published.length,8);
});

