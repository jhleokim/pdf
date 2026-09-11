const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/pro-gemini.js'),'utf8');
const line={text:'계약 금액 123,450원',box:[100,150,145,750],uncertain:false};
const success=()=>Response.json({lines:[line],model:'test-model'});
const next=()=>new Promise(resolve=>setImmediate(resolve));
async function until(condition){for(let i=0;i<30;i++){if(condition())return;await next();}throw Error('Controlled operation did not start');}
function harness(options={}){
  const calls=[],qualities=[],timers=new Map();let timerId=0,encodeCallback=null,reader=null;
  class Reader{
    readAsDataURL(blob){reader=this;if(options.holdRead)return;this.result='data:image/jpeg;base64,'+(blob.base64||'/9j/AA==');queueMicrotask(()=>this.onload?.());}
    abort(){this.aborted=true;this.onabort?.();}
  }
  const context={URL,AbortController,DOMException,Uint8Array,TextDecoder,Date:options.Date||Date,FileReader:Reader,
    location:{protocol:options.protocol||'https:',href:options.protocol==='file:'?'file:///test/PDF-Studio.html':'https://pdf.example.test/studio'},
    setTimeout:(callback,ms)=>{const id=++timerId;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,init)=>{calls.push({url,init});return options.fetch?options.fetch(url,init):success();}};
  vm.createContext(context);vm.runInContext(source,context);
  const canvas={width:2400,height:3300,toBlob:(callback,type,quality)=>{
    qualities.push({type,quality});encodeCallback=callback;if(options.holdEncode)return;
    const size=options.sizes?.[qualities.length-1]??1000;
    queueMicrotask(()=>callback(options.nullBlob?null:{type:options.blobType||type,size,base64:'/9j/AA=='}));
  }};
  return {api:context.PDFGemini,canvas,calls,qualities,timers,get reader(){return reader;},finishEncoding:()=>encodeCallback?.({type:'image/jpeg',size:1000}),
    timeout:()=>{for(const {callback}of timers.values())callback();}};
}
async function session(h,controller=new AbortController()){return {controller,engine:await h.api.session('kor+eng',controller.signal,null,true)};}
const aborted=error=>error.name==='AbortError';
const invalid=error=>error.code==='GEMINI_RESULT_INVALID';

test('valid recognition keeps full JPEG quality and converts all line coordinates',async()=>{
  const h=harness(),{engine}=await session(h),result=await engine.recognize(h.canvas);
  assert.equal(result.text,line.text);assert.equal(result.model,'test-model');assert.equal(result.source,'gemini');assert.equal(result.confidence,null);
  assert.deepEqual(JSON.parse(JSON.stringify(result.words[0])),{text:line.text,box:[.15,.1,.75,.145],separator:'\n',confidence:null,uncertain:false});
  assert.deepEqual(h.qualities,[{type:'image/jpeg',quality:.94}]);assert.equal(h.calls.length,1);
  const {url,init}=h.calls[0];assert.equal(url,'https://pdf.example.test/api/ocr/gemini');assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');
  assert.deepEqual(JSON.parse(init.body),{consent:true,language:'kor+eng',image:'/9j/AA==',mimeType:'image/jpeg'});assert.equal(h.timers.size,0);
});

test('consent and web origin are required before connecting or encoding',async()=>{
  const h=harness();await assert.rejects(h.api.session('eng',new AbortController().signal,null,false));assert.equal(h.calls.length,0);assert.equal(h.qualities.length,0);
  const file=harness({protocol:'file:'});await assert.rejects(file.api.available(new AbortController().signal));await assert.rejects(file.api.session('eng',new AbortController().signal,null,true));
  assert.equal(file.calls.length,0);assert.equal(file.qualities.length,0);
});

test('canceling JPEG encoding or FileReader work sends no page',async()=>{
  for(const options of [{holdEncode:true},{holdRead:true}]){
    const h=harness(options),{controller,engine}=await session(h),pending=engine.recognize(h.canvas);
    const rejected=assert.rejects(pending,aborted);await until(()=>options.holdRead?h.reader:h.qualities.length);controller.abort();await rejected;
    h.finishEncoding();await next();assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);if(options.holdRead)assert.equal(h.reader.aborted,true);
  }
});

test('closing a session aborts its active request and prevents another page',async()=>{
  let requestAborted=false;
  const h=harness({fetch:(url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{requestAborted=true;reject(init.signal.reason);},{once:true}))});
  const {engine}=await session(h),pending=engine.recognize(h.canvas),rejected=assert.rejects(pending,aborted);
  await until(()=>h.calls.length);await engine.close();await rejected;assert.equal(requestAborted,true);assert.equal(h.timers.size,0);
  await assert.rejects(engine.recognize(h.canvas),aborted);assert.equal(h.calls.length,1);
});

test('a stalled response body is canceled by the overall timeout',async()=>{
  let canceled=false;
  const h=harness({fetch:async()=>new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'Content-Type':'application/json'}})});
  const {engine}=await session(h),pending=engine.recognize(h.canvas),rejected=assert.rejects(pending,error=>error.code==='GEMINI_TIMEOUT'&&error.status===504);
  await until(()=>h.calls.length);await next();h.timeout();await rejected;assert.equal(canceled,true);assert.equal(h.timers.size,0);
});

test('response size is bounded even when Content-Length is absent',async()=>{
  let canceled=false;
  const h=harness({fetch:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2*1024*1024+1));},cancel(){canceled=true;}}),{headers:{'Content-Type':'application/json'}})});
  const {engine}=await session(h);await assert.rejects(engine.recognize(h.canvas),invalid);assert.equal(canceled,true);assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});

test('server error code and retry delay reach the caller without another upload',async()=>{
  for(const item of [{body:{error:'Try later',code:'GEMINI_RATE_LIMIT',retryAfter:12.2},header:'90',expected:13},{body:{error:'Try later',code:'GEMINI_RATE_LIMIT'},header:'45',expected:45}]){
    const h=harness({fetch:async()=>Response.json(item.body,{status:429,headers:{'Retry-After':item.header}})}),{engine}=await session(h);
    await assert.rejects(engine.recognize(h.canvas),error=>error.message==='Try later'&&error.code==='GEMINI_RATE_LIMIT'&&error.status===429&&error.retryAfter===item.expected);
    assert.equal(h.calls.length,1);
  }
});
test('quota cooldown blocks repeat uploads and allows a later manual retry',async()=>{
 let time=100000;class Clock extends Date{static now(){return time;}}
 const h=harness({Date:Clock,fetch:async()=>h.calls.length===1?Response.json({error:'quota',code:'GEMINI_QUOTA',retryAfter:30},{status:429}):success()}),{engine}=await session(h);
 await assert.rejects(engine.recognize(h.canvas),e=>e.code==='GEMINI_QUOTA');
 const available=await h.api.available(new AbortController().signal);assert.equal(available.retryAfter,30);
 await assert.rejects(engine.recognize(h.canvas),e=>e.code==='GEMINI_QUOTA');assert.equal(h.calls.length,1);assert.equal(h.qualities.length,1);
 time+=31000;assert.equal((await engine.recognize(h.canvas)).text,line.text);assert.equal(h.calls.length,2);
});

test('malformed lines reject the whole result instead of silently dropping text',async()=>{
  const malformed=[null,{...line,text:''},{...line,text:'unsafe\u0000text'},{...line,uncertain:undefined},{...line,box:[100,500,140,400]},{...line,box:[100,150,145,1001]},{...line,box:[100,150,145,'750']},{...line,text:'x'.repeat(2001)}];
  for(const bad of malformed){
    const h=harness({fetch:async()=>Response.json({lines:[line,bad],model:'test-model'})}),{engine}=await session(h);
    await assert.rejects(engine.recognize(h.canvas),invalid);assert.equal(h.calls.length,1);
  }
  const h=harness({fetch:async()=>Response.json({lines:Array.from({length:31},()=>({...line,text:'x'.repeat(2000)}))})}),{engine}=await session(h);
  await assert.rejects(engine.recognize(h.canvas),invalid);
});

test('JPEG fallback is limited to oversized images and fails safely above the upload cap',async()=>{
  for(const item of [{sizes:[7*1024*1024,4*1024*1024],qualities:[.94,.88]},{sizes:[7*1024*1024,7*1024*1024,4*1024*1024],qualities:[.94,.88,.8]}]){
    const h=harness({sizes:item.sizes}),{engine}=await session(h);await engine.recognize(h.canvas);
    assert.deepEqual(h.qualities.map(item=>item.quality),item.qualities);assert.equal(h.calls.length,1);
  }
  const large=harness({sizes:[7*1024*1024,7*1024*1024,7*1024*1024]}),{engine}=await session(large);
  await assert.rejects(engine.recognize(large.canvas));assert.equal(large.calls.length,0);assert.deepEqual(large.qualities.map(item=>item.quality),[.94,.88,.8]);
});
