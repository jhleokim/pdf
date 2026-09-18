const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/privacy-native.js'),'utf8');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function harness({autoReady=true}={}){
 let now=0,timerId=0;const timers=new Map(),workers=[],events={};
 class Worker{
  constructor(){this.messages=[];this.terminated=0;workers.push(this);}
  postMessage(value){this.messages.push(value);if(value.init&&autoReady)queueMicrotask(()=>this.emit({ready:true}));}
  terminate(){this.terminated++;}
  emit(data){this.onmessage?.({data});}
 }
 const spec={bytes:1,sha256:'00'.repeat(32)},context=vm.createContext({Uint8Array,Blob,DOMException,Worker,AbortController,atob,
  document:{getElementById:()=>({textContent:'AQ=='})},PDFPrivacyAssets:{wasm:spec,worker:spec},
  crypto:{subtle:{digest:async()=>new Uint8Array(32)}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},
  PDFLib:{PDFContext:{create:()=>({obj:x=>x})},PDFRawStream:{of:()=>({})},decodePDFRawStream:()=>({decode:()=>new Uint8Array([0])})},
  addEventListener:(type,callback)=>events[type]=callback,
  setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{at:now+delay,fn});return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(source,context);
 async function advance(ms){const until=now+ms;while(true){const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=until;await flush();}
 const run=options=>context.PDFPrivacyNative.run(new Uint8Array([1]),[[]],options);
 const job=worker=>worker.messages.find(message=>message.id);
 return {api:context.PDFPrivacyNative,workers,events,advance,run,job};
}
test('redaction keeps making progress beyond the old two-minute document cutoff',async()=>{
 const h=harness(),progress=[],result=h.run({onProgress:(n,total)=>progress.push([n,total])});await flush();const w=h.workers[0],id=h.job(w).id;
 await h.advance(110000);w.emit({id,done:1,total:3});await h.advance(110000);w.emit({id,done:2,total:3});await h.advance(110000);
 assert.equal(w.terminated,0);w.emit({id,result:{bytes:new Uint8Array([7])}});assert.equal((await result).bytes[0],7);assert.deepEqual(progress,[[1,3],[2,3]]);
});
test('repeated, invalid, decreasing or changed-total progress cannot postpone a stalled-job deadline',async()=>{
 const h=harness(),result=h.run(),rejected=assert.rejects(result,/응답이 멈췄습니다/);await flush();const w=h.workers[0],id=h.job(w).id;
 w.emit({id,done:1,total:3});await h.advance(100000);
 for(const [done,total]of [[1,3],[0,3],[1.5,3],[4,3],[2,4],[Infinity,3]])w.emit({id,done,total});
 await h.advance(20000);await rejected;assert.equal(w.terminated,1);
});
test('placement analysis also allows longer documents while retaining its shorter inactivity deadline',async()=>{
 const h=harness(),result=h.api.placements(new Uint8Array([1]));await flush();const w=h.workers[0],id=h.job(w).id;
 await h.advance(25000);w.emit({id,done:1,total:2});await h.advance(25000);assert.equal(w.terminated,0);
 w.emit({id,result:{placements:{1:[100,200]}}});assert.deepEqual((await result).placements,{1:[100,200]});
});
test('canceling an active job terminates its worker and late replies cannot affect the next job',async()=>{
 const h=harness(),controller=new AbortController(),first=h.run({signal:controller.signal}),rejected=assert.rejects(first,{name:'AbortError'});await flush();const old=h.workers[0],id=h.job(old).id;
 controller.abort();await rejected;assert.equal(old.terminated,1);
 const second=h.run();await flush();const next=h.workers[1];old.emit({id,result:{wrong:true}});old.emit({ready:true});
 next.emit({id:h.job(next).id,result:{ok:true}});assert.equal((await second).ok,true);
});
test('disposing during initialization rejects immediately and a new job can initialize again',async()=>{
 const h=harness({autoReady:false}),first=h.run(),rejected=assert.rejects(first,{name:'AbortError'});await flush();const old=h.workers[0];
 h.api.dispose();await rejected;assert.equal(old.terminated,1);
 const second=h.run();await flush();old.emit({ready:true});const next=h.workers[1];next.emit({ready:true});await flush();
 next.emit({id:h.job(next).id,result:{ok:true}});assert.equal((await second).ok,true);
});
test('a queued cancellation never starts a second worker operation',async()=>{
 const h=harness(),first=h.run();await flush();const w=h.workers[0],controller=new AbortController(),second=h.run({signal:controller.signal}),rejected=assert.rejects(second,{name:'AbortError'});
 controller.abort();w.emit({id:h.job(w).id,result:{ok:true}});await first;await rejected;assert.equal(w.messages.filter(m=>m.id).length,1);
});
