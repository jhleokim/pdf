const test=require('node:test'),assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads'),{Script}=require('node:vm'),{inflateSync}=require('node:zlib');
const runtime=import('../scripts/build-privacy.mjs').then(m=>m.buildPrivacyAssets());
const fixture=async()=>{
 const M=await import('mupdf'),d=new M.PDFDocument();
 try{
  const f=d.addSimpleFont(new M.Font('Helvetica'));
  const p=d.addPage([0,0,400,600],0,{Font:{F1:f}},'BT /F1 20 Tf 30 500 Td (SECRET) Tj 0 -400 Td (PUBLIC) Tj ET');d.insertPage(-1,p);
  const b=d.saveToBuffer();try{return b.asUint8Array().slice();}finally{b.destroy();}
 }finally{d.destroy();}
};
async function boot(t,wasm){
 const assets=await runtime,code=inflateSync(assets.worker.packed).toString();
 assert.doesNotThrow(()=>new Script(code),'worker parses as a classic script');
 assert.doesNotMatch(code,/\bimport\s*(?:\(|\.)|\bexport\s*\{/,'worker has no module dependencies');
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');
  globalThis.self=globalThis;globalThis.WorkerGlobalScope=class{};
  globalThis.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);
  globalThis.fetch=()=>{throw Error('Network forbidden in standalone test');};
  parentPort.on('message',data=>self.onmessage({data}));
  require('node:vm').runInThisContext(${JSON.stringify(code)});`,{eval:true});
 t.after(()=>worker.terminate());
 const messages=[],waiters=[];
 worker.on('message',m=>{const next=waiters.shift();next?next.resolve(m):messages.push(m);});
 worker.on('error',e=>{for(const w of waiters.splice(0))w.reject(e);});
 const next=()=>messages.length?Promise.resolve(messages.shift()):new Promise((resolve,reject)=>waiters.push({resolve,reject}));
 worker.postMessage({init:true,wasm:wasm||inflateSync(assets.wasm.packed)});
 return {worker,next};
}
test('shipped classic worker boots offline and removes only masked text', {timeout:20000},async t=>{
 const {worker,next}=await boot(t);assert.equal((await next()).ready,true);
 worker.postMessage({id:1,bytes:await fixture(),masks:[[[0,.1,1,.1]]]});
 let m;do{m=await next();assert.equal(m.error,undefined);}while(!m.result);
 const M=await import('mupdf'),d=M.Document.openDocument(m.result.bytes,'application/pdf');
 try{const p=d.loadPage(0),s=p.toStructuredText();try{
  assert.match(s.asText(),/PUBLIC/);assert.doesNotMatch(s.asText(),/SECRET/);
 }finally{s.destroy();p.destroy();}}finally{d.destroy();}
});
test('shipped worker reports a WASM initialization failure instead of hanging', {timeout:20000},async t=>{
 const {next}=await boot(t,new Uint8Array([1,2,3]));
 const m=await next();assert.match(m.error,/개인정보 삭제 엔진을 시작하지 못했습니다/);
 assert.notEqual(m.ready,true);
});
