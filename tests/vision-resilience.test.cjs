const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const success=()=>Response.json({text:'계약',words:[{text:'계약',box:[0,0,.5,.1],separator:'\n',confidence:90}]});
function harness(reply){
 let time=0,id=0,encodes=0;const calls=[],events=[],timers=new Map();
 class Clock extends Date{static now(){return time;}}
 class Reader{readAsDataURL(){this.result='data:image/jpeg;base64,/9j/AAAAAAAAAAAA';queueMicrotask(()=>this.onload?.());}abort(){this.onabort?.();}}
 const context={URL,AbortController,DOMException,Uint8Array,TextDecoder,Date:Clock,FileReader:Reader,location:{protocol:'https:',href:'https://pdf.test/'},
  setTimeout(fn,ms){const key=++id;timers.set(key,{fn,ms});if(ms<=1000)queueMicrotask(()=>{if(timers.delete(key)){time+=ms;fn();}});return key;},clearTimeout:key=>timers.delete(key),
  fetch:async(url,init)=>{calls.push({url,init});return reply(calls.length,init);}};
 vm.createContext(context);for(const name of ['pro-gemini.js','pro-vision.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),context);
 return {api:context.PDFVision,calls,events,timers,get time(){return time;},get encodes(){return encodes;},canvas:{width:100,height:200,toBlob:cb=>{encodes++;queueMicrotask(()=>cb({type:'image/jpeg',size:100}));}}};
}
test('212-page Vision run resumes the same page after rate limiting at 60 and 140 without repeated encoding',async()=>{
 let page=1;const retried=new Set(),h=harness(()=>{
  if([60,140].includes(page)&&!retried.has(page)){retried.add(page);return Response.json({code:'VISION_RATE_LIMIT',error:'Busy',retryAfter:60},{status:429});}
  page++;return success();
 });
 const s=await h.api.session('kor+eng',new AbortController().signal,e=>h.events.push(e),true);
 for(let n=0;n<212;n++)assert.equal((await s.recognize(h.canvas)).text,'계약');await s.close();
 assert.equal(page,213);assert.equal(h.calls.length,214);assert.equal(h.encodes,212);assert.equal(h.time,120000);assert.equal(h.timers.size,0);
 assert.deepEqual(h.events.filter(e=>e.status==='retrying'&&e.retryAfter===60).map(e=>e.attempt),[2,2]);
 assert.equal(h.calls[59].init.body,h.calls[60].init.body);assert.equal(h.calls[140].init.body,h.calls[141].init.body);
});
test('temporary transport failures recover but persistent failures stop after three attempts',async()=>{
 const h=harness(n=>n<3?Response.json({code:'VISION_UPSTREAM',error:'Unavailable'},{status:502}):success()),s=await h.api.session('eng',new AbortController().signal,null,true);
 assert.equal((await s.recognize(h.canvas)).text,'계약');assert.equal(h.calls.length,3);assert.equal(h.encodes,1);await s.close();
 const bad=harness(()=>{throw new TypeError('Failed to fetch');}),b=await bad.api.session('eng',new AbortController().signal,null,true);
 await assert.rejects(b.recognize(bad.canvas),{name:'TypeError'});assert.equal(bad.calls.length,3);assert.equal(bad.timers.size,0);await b.close();
});
test('long quota waits, invalid text, billing, image and authentication failures are not retried',async()=>{
 for(const [code,status,extra]of [['VISION_QUOTA',429,{retryAfter:3600}],['VISION_AUTH',503,{}],['VISION_BILLING',503,{}],['VISION_IMAGE',400,{}],['VISION_RESULT_INVALID',502,{}]]){
  const h=harness(()=>Response.json({code,error:code,...extra},{status})),s=await h.api.session('eng',new AbortController().signal,null,true);
  await assert.rejects(s.recognize(h.canvas),e=>e.code===code);assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);await s.close();
 }
});
test('cancel during quota countdown prevents any later upload and releases timers',async()=>{
 const ctrl=new AbortController(),h=harness(()=>Response.json({code:'VISION_RATE_LIMIT',error:'Busy',retryAfter:60},{status:429}));
 const s=await h.api.session('eng',ctrl.signal,e=>{if(e.status==='retrying')ctrl.abort();},true);
 await assert.rejects(s.recognize(h.canvas),{name:'AbortError'});assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);await s.close();
});
test('HTML authentication errors never trigger another upload',async()=>{
 const h=harness(()=>new Response('Sign in',{status:403,headers:{'Content-Type':'text/html'}})),s=await h.api.session('eng',new AbortController().signal,null,true);
 await assert.rejects(s.recognize(h.canvas),e=>e.status===403);assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);await s.close();
});
test('a stalled Vision response is canceled at the attempt deadline and retries safely',async()=>{
 let canceled=false;const h=harness(n=>n===1?new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'Content-Type':'application/json'}}):success());
 const s=await h.api.session('eng',new AbortController().signal,null,true),result=s.recognize(h.canvas);
 for(let i=0;i<20&&!h.calls.length;i++)await new Promise(r=>setImmediate(r));
 await new Promise(r=>setImmediate(r));[...h.timers.values()].find(t=>t.ms===60000).fn();
 assert.equal((await result).text,'계약');assert.equal(canceled,true);assert.equal(h.calls.length,2);assert.equal(h.timers.size,0);await s.close();
});
test('source page reuse is forbidden for masks, edits or image/page transformations',()=>{
 const policy=require('../src/ocr-page-policy.js'),p={uid:'p1',rotation:0,annots:[]},o={paper:'original',whitePoint:255};
 assert.equal(policy.canRenderSource(p,o),true);
 for(const change of [{optimize:true},{rasterize:true},{blackWhite:true},{grayscale:true},{contrast:1},{whitePoint:250},{deskew:true},{deskewAngles:{p1:1}},{deskewCropByPage:{p1:true}},{crop:true},{paper:'a4'},{number:true},{watermark:'TEST'},{stamps:[{}]},{ocr:[{}]}])assert.equal(policy.canRenderSource(p,{...o,...change}),false,JSON.stringify(change));
 assert.equal(policy.canRenderSource({...p,rotation:90},o),false);assert.equal(policy.canRenderSource({...p,annots:[{shape:'redaction'}]},o),false);
 assert.equal(policy.canRenderSource(p,{...o,deskewAngles:{other:4}}),true);
});
