const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function harness(){
  const fields=new Map(),started=deferred(),buildGate=deferred();let working=false,mounts=0,saves=0,signal;
  const $=id=>{if(!fields.has(id))fields.set(id,{open:false,disabled:false,textContent:'',addEventListener(){},removeAttribute(){},close(){this.open=false;},click(){if(!this.disabled)this.onclick?.();}});return fields.get(id);};
  const ctx=vm.createContext({console,AbortController,Blob,URL,setTimeout,clearTimeout,$,pages:[{uid:'p1'}],proMode:'basic',proAbort:null,textUpdate:Promise.resolve(),textEditPending:false,
    document:{querySelector:()=>null,addEventListener(){},body:{classList:{contains:()=>working}}},window:{addEventListener(){}},
    busy:value=>working=value,progress(){},cancelLivePreview(){},syncProState(){},finishTextEdit:()=>true,confirmDocumentExport:async()=>true,toast(){},
    async buildEditedDocument(pages,options){signal=options.signal;started.resolve();await buildGate.promise;return {async save(){saves++;return new Uint8Array([1]);}};},
    finalizePrivateExport:async doc=>doc});
  const pro=read('pro-ui.js');
  vm.runInContext(pro.slice(pro.indexOf('function startProWork('),pro.indexOf('async function verifyProText(')),ctx);
  vm.runInContext(pro.split('\n').find(line=>line.startsWith("$('busyCancel').onclick=")),ctx);
  vm.runInContext(read('print-ui.js'),ctx);
  ctx.mountPrintDocument=job=>{mounts++;job.phase='ready';};
  return {ctx,$,started:started.promise,release:buildGate.resolve,state:()=>vm.runInContext('printJob',ctx),get working(){return working;},get mounts(){return mounts;},get saves(){return saves;},get signal(){return signal;}};
}

test('canceling Basic print preparation aborts its build and never mounts a print document',async()=>{
  const h=harness(),pages=h.ctx.pages,pending=h.ctx.printCurrentDocument();await h.started;
  assert.equal(h.state().phase,'preparing');assert.equal(h.working,true);
  h.$('busyCancel').click();assert.equal(h.signal.aborted,true);h.release();await pending;
  assert.equal(h.state(),null);assert.equal(h.mounts,0);assert.equal(h.saves,0);assert.equal(h.working,false);assert.equal(h.$('printDialog').open,false);assert.equal(h.ctx.pages,pages);
});
