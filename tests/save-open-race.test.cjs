'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/save-ui.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function harness(){
 const elements=new Map(),builds=[],downloads=[];let busy=false,opens=0;
 const element=id=>{
  if(!elements.has(id))elements.set(id,{open:false,value:'',textContent:'',dataset:{},addEventListener(){},setAttribute(){},focus(){},select(){},close(){this.open=false;},showModal(){opens++;this.open=true;}});
  return elements.get(id);
 };
 const ctx=vm.createContext({console,AbortController,structuredClone,Uint8Array,Map,Set,
  $:element,pages:[{uid:'p1',docId:'d1',srcIndex:0,annots:[{shape:'text',text:'old'}]}],docs:new Map(),proMode:'basic',proResult:null,
  textUpdate:Promise.resolve(),textEditPending:false,
  document:{body:{classList:{contains:()=>busy}}},PDFSource:{filename:()=> 'draft'},selected:()=>ctx.pages,
  finishTextEdit:()=>!ctx.textEditPending,proFingerprint:()=>JSON.stringify(ctx.pages),confirmDocumentExport:async()=>true,
  buildEditedDocument:async pages=>{builds.push(pages);return {save:async()=>new Uint8Array([pages[0].annots[0].text.length])};},
  finalizePrivateExport:async doc=>doc,idle:async()=>{},formatBytes:bytes=>String(bytes),downloadPdf:(bytes,name)=>downloads.push({bytes,name}),
  scheduleLivePreview(){},toast(){}});
 vm.runInContext(source,ctx);
 return {ctx,builds,downloads,element,state:()=>vm.runInContext('basicSaveState',ctx),setBusy:v=>busy=v,opens:()=>opens};
}

test('save waits for the latest text layout when a newer edit supersedes the promise being awaited',async()=>{
 const h=harness(),first=deferred(),latest=deferred();h.ctx.textUpdate=first.promise;h.ctx.textEditPending=true;
 const pending=h.ctx.openBasicSaveDialog();
 h.ctx.textUpdate=latest.promise;first.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.opens(),0);assert.equal(h.builds.length,0);
 h.ctx.pages[0].annots[0].text='latest Korean draft';h.ctx.textEditPending=false;latest.resolve();await pending;
 assert.equal(h.opens(),1);assert.equal(h.state().phase,'ready');assert.equal(h.builds[0][0].annots[0].text,'latest Korean draft');
 h.ctx.downloadBasicSave();assert.equal(h.downloads[0].bytes[0],'latest Korean draft'.length);
});

test('repeated Save clicks while layout is pending share one dialog and one preparation',async()=>{
 const h=harness(),layout=deferred();h.ctx.textUpdate=layout.promise;h.ctx.textEditPending=true;
 const first=h.ctx.openBasicSaveDialog(),second=h.ctx.openBasicSaveDialog();h.ctx.textEditPending=false;layout.resolve();await Promise.all([first,second]);
 assert.equal(h.opens(),1);assert.equal(h.builds.length,1);assert.equal(h.state().phase,'ready');
});

test('save does not start if another export becomes busy while text layout is pending',async()=>{
 const h=harness(),layout=deferred();h.ctx.textUpdate=layout.promise;h.ctx.textEditPending=true;
 const pending=h.ctx.openBasicSaveDialog();h.setBusy(true);h.ctx.textEditPending=false;layout.resolve();await pending;
 assert.equal(h.opens(),0);assert.equal(h.builds.length,0);assert.equal(h.state(),null);
});
