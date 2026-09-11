const test=require('node:test'),assert=require('node:assert/strict');
const mod=import('../src/paddle/worker-client.mjs');
const canvas={width:1,height:1,getContext:()=>({getImageData:()=>({width:1,height:1,data:new Uint8ClampedArray(4)})})};
function harness(){let worker;class Worker{constructor(url,options){worker=this;this.url=url;this.options=options;this.messages=[];this.terminated=0;}postMessage(message,transfer){this.messages.push({message,transfer});}terminate(){this.terminated++;}emit(type,value={}){this.onmessage({data:{id:this.messages.at(-1).message.id,type,...value}});}}return {Worker,get worker(){return worker;}};}
test('cancel terminates a stuck model initializer and ignores its late completion',async()=>{
 const {createWorkerSession}=await mod,h=harness(),ctrl=new AbortController();
 const pending=createWorkerSession('/worker.mjs',ctrl.signal,null,{WorkerImpl:h.Worker});
 const rejected=assert.rejects(pending,e=>e.name==='AbortError');ctrl.abort();await rejected;assert.equal(h.worker.terminated,1);
 h.worker.emit('result');assert.equal(h.worker.terminated,1);
});
test('recognition reuses its worker, transfers pixels and closes without waiting for the GPU',async()=>{
 const {createWorkerSession}=await mod,h=harness(),ctrl=new AbortController(),pending=createWorkerSession('/worker.mjs',ctrl.signal,null,{WorkerImpl:h.Worker});h.worker.emit('result');const session=await pending;
 const result=session.recognize(canvas);h.worker.emit('result',{result:{text:'한글'}});assert.deepEqual(await result,{text:'한글'});assert.equal(h.worker.messages.at(-1).transfer.length,1);
 const hanging=session.recognize(canvas),rejected=assert.rejects(hanging,e=>e.name==='AbortError');await session.close();await rejected;assert.equal(h.worker.terminated,1);await session.close();assert.equal(h.worker.terminated,1);
});
test('a page deadline still expires when the worker keeps emitting progress',async()=>{
 const {createWorkerSession}=await mod,h=harness(),ctrl=new AbortController(),pending=createWorkerSession('/worker.mjs',ctrl.signal,null,{WorkerImpl:h.Worker,pageTimeout:30,idleTimeout:100});h.worker.emit('result');const session=await pending;
 const hanging=session.recognize(canvas),rejected=assert.rejects(hanging,e=>e.code==='PADDLE_TIMEOUT');const heartbeat=setInterval(()=>h.worker.emit('progress',{progress:{status:'recognizing text'}}),5);
 try{await rejected;}finally{clearInterval(heartbeat);}assert.equal(h.worker.terminated,1);
});
test('a silent worker fails within its idle deadline rather than waiting forever',async()=>{
 const {createWorkerSession}=await mod,h=harness();await assert.rejects(createWorkerSession('/worker.mjs',new AbortController().signal,null,{WorkerImpl:h.Worker,idleTimeout:10,initTimeout:200}),e=>e.code==='PADDLE_TIMEOUT');assert.equal(h.worker.terminated,1);
});
test('worker errors reject pending requests and release the worker',async()=>{
 const {createWorkerSession}=await mod,h=harness(),pending=createWorkerSession('/worker.mjs',new AbortController().signal,null,{WorkerImpl:h.Worker});const rejected=assert.rejects(pending,e=>e.code==='PADDLE_WORKER_FAILED');h.worker.onerror({preventDefault(){}});await rejected;assert.equal(h.worker.terminated,1);
});
