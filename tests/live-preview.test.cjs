const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../src/pro-live-preview.js'),'utf8');
function harness(){
 const elements=new Map(), published=[];let release;
 const element=id=>{
  if(!elements.has(id))elements.set(id,{id,value:'1',clientWidth:500,clientHeight:600,attrs:{},classList:{toggle(){}},
   setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]||'';},removeAttribute(k){delete this.attrs[k];},
   addEventListener(){},focus(){},replaceWith(canvas){published.push(id);elements.set(id,canvas);}});
  return elements.get(id);
 };
 let processing=0;
 const report={changed:1,skipped:0,imageCount:1,notes:[]};
 const doc=()=>({save:async()=>new Uint8Array([1,2,3])});
 const c=vm.createContext({AbortController,DOMException,console,Number,JSON,Promise,setTimeout,clearTimeout,
  $:element,proReady:true,proMode:'pro',proAbort:null,proControlIds:[],pages:[{uid:'p1'}],previewUid:'p1',selected:()=>[],
  proFingerprint:()=>'',isMobile:()=>false,setProView(){},devicePixelRatio:1,ResizeObserver:class{observe(){}},
  document:{body:{classList:{toggle(){}}},addEventListener(){},createElement(){return {style:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]||'';},getContext(){return {};},replaceWith(canvas){published.push(this.id);elements.set(this.id,canvas);}};}},
  requestAnimationFrame:fn=>fn(),showPreview(){},readProOptions:()=>({grayscale:true}),buildEditedDocument:async()=>doc(),
  PDFLib:{PDFDocument:{load:async()=>doc()}},PDFPro:{processDocument:async()=>{if(processing++===0)await new Promise(r=>release=r);return report;}},
  PDFProDocument:{applyDocument:async()=>{}},PDFDeskew:{processDocument:async()=>({changed:0,pages:[]})},describeProSettings:()=>'test',verifyProText:async(a,b,signal,quiet)=>assert.equal(quiet,true),DOC_OPTS:{},
  pdfjsLib:{getDocument:()=>({promise:Promise.resolve({getPage:async()=>({getViewport:({scale})=>({width:100*scale,height:200*scale}),render:()=>({promise:Promise.resolve()})}),destroy:async()=>{}})})}
 });
 c.PDFProPipeline={apply:async(d,o,cb)=>{await c.PDFDeskew.processDocument(d,o,cb);const r=await c.PDFPro.processDocument(d,o,cb);await c.PDFProDocument.applyDocument(d,o,cb);return {doc:d,report:{...r,deskew:{changed:0,pages:[]}}};}};
 vm.runInContext(code+'\nliveHadPages=true;',c);
 return {c,element,published,release:()=>release(),isWaiting:()=>!!release};
}
test('a superseded preview never publishes stale canvases and the newer result succeeds',async()=>{
 const h=harness();const first=vm.runInContext('updateLivePreview(0)',h.c);
 while(!h.isWaiting())await new Promise(r=>setImmediate(r));
 vm.runInContext('cancelLivePreview()',h.c);h.release();await first;
 assert.deepEqual(h.published,[]);
 await vm.runInContext('updateLivePreview(1)',h.c);
 assert.deepEqual(h.published,['compareBefore','compareAfter']);
 assert.equal(h.element('compareState').textContent,'미리보기 업데이트 완료');
 assert.equal(h.element('compareOriginal').disabled,false);
});
test('closing a preview cancels in-flight work without publishing an obsolete result',async()=>{
 const h=harness();const job=vm.runInContext('updateLivePreview(0)',h.c);
 while(!h.isWaiting())await new Promise(r=>setImmediate(r));
 vm.runInContext('setLivePreviewOpen(false)',h.c);h.release();await job;
 assert.deepEqual(h.published,[]);assert.equal(h.element('proCompare').hidden,true);
 assert.equal(h.element('proPreviewLabel').textContent,'페이지 미리보기');
});

