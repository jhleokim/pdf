const test=require('node:test'),assert=require('node:assert/strict');
const mod=import('../server/worker.mjs');
const input={consent:true,language:'kor+eng',mimeType:'image/jpeg',image:'/9j/AAAAAAAAAAAA'};
const request=(body=input,headers={})=>new Request('https://pdf.test/api/ocr/vision',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const env={GOOGLE_VISION_API_KEY:'test-vision-key',OCR_RATE_LIMIT:{limit:async()=>({success:true})}};
const word={symbols:[{text:'계'},{text:'약',property:{detectedBreak:{type:'SPACE'}}}],boundingBox:{vertices:[{}, {x:50}, {x:50,y:10},{y:10}]},confidence:.92};
const fixture=()=>({responses:[{fullTextAnnotation:{text:'계약\n',pages:[{width:100,height:200,blocks:[{paragraphs:[{words:[structuredClone(word)]}]}]}]}}]});
test('Vision uses document OCR/latest and a distinct server key, and normalizes zero vertices',async()=>{
 let sent;const worker=(await mod).createWorker(async(url,init)=>{sent={url,init};return Response.json(fixture());});
 const r=await worker.fetch(request(),env),result=await r.json();assert.equal(r.status,200);assert.equal(result.text,'계약\n');assert.deepEqual(result.words[0],{text:'계약',box:[0,0,.5,.05],separator:'\n',confidence:92});
 assert.equal(new URL(sent.url).origin+new URL(sent.url).pathname,'https://vision.googleapis.com/v1/images:annotate');assert.equal(new URL(sent.url).searchParams.get('prettyPrint'),'false');assert.ok(new URL(sent.url).searchParams.get('fields').includes('boundingBox'));assert.equal(sent.init.headers['x-goog-api-key'],env.GOOGLE_VISION_API_KEY);assert.ok(!sent.url.includes(env.GOOGLE_VISION_API_KEY));
 const payload=JSON.parse(sent.init.body);assert.deepEqual(payload.requests[0].features,[{type:'DOCUMENT_TEXT_DETECTION',model:'builtin/latest'}]);assert.deepEqual(payload.requests[0].imageContext.languageHints,['ko','en']);assert.equal(payload.requests[0].image.content,input.image);
 assert.equal(JSON.stringify(result).includes(env.GOOGLE_VISION_API_KEY),false);assert.equal(r.headers.get('cache-control'),'no-store');
});
test('no key, no consent, oversized body and foreign origin never upload a page',async()=>{
 let calls=0;const worker=(await mod).createWorker(async()=>{calls++;throw Error('unexpected');});
 assert.equal((await worker.fetch(request(),{GEMINI_API_KEY:'unrelated-key'})).status,503);
 assert.equal((await worker.fetch(request({...input,consent:false}),env)).status,400);
 assert.equal((await worker.fetch(request(input,{Origin:'https://foreign.test'}),env)).status,403);
 assert.equal((await worker.fetch(request(input,{'Content-Length':String(9*1024*1024)}),env)).status,413);assert.equal(calls,0);
 const status=await worker.fetch(new Request('https://pdf.test/api/ocr/vision'),{});assert.deepEqual(await status.json(),{available:false,model:'builtin/latest'});
});
test('quota, billing and API activation failures are controlled and not retried',async()=>{
 for(const [error,status,code] of [[{code:8},200,'VISION_QUOTA'],[{details:[{reason:'BILLING_DISABLED'}]},403,'VISION_BILLING'],[{details:[{reason:'SERVICE_DISABLED'}]},403,'VISION_API_DISABLED']]){
   let calls=0;const worker=(await mod).createWorker(async()=>{calls++;return Response.json(status===200?{responses:[{error}]}:{error},{status});});const r=await worker.fetch(request(),env);assert.equal((await r.json()).code,code);assert.equal(calls,1);
 }
});
test('partial errors and invalid geometry reject the result rather than losing text',async()=>{
 for(const mutate of [x=>x.responses[0].error={code:13},x=>x.responses[0].fullTextAnnotation.pages[0].blocks[0].paragraphs[0].words[0].boundingBox.vertices=[],x=>x.responses[0].fullTextAnnotation.pages[0].blocks=[]]){
  const f=fixture();mutate(f);const worker=(await mod).createWorker(async()=>Response.json(f));assert.equal((await worker.fetch(request(),env)).status,502);
 }
 const worker=(await mod).createWorker(async()=>Response.json({responses:[{}]}));const data=await (await worker.fetch(request(),env)).json();assert.deepEqual(data.words,[]);assert.equal(data.text,'');
});
test('abort stops the upstream body and returns without persisting partial text',async()=>{
 let opened;const ready=new Promise(r=>opened=r);let canceled=false;const worker=(await mod).createWorker(async()=>new Response(new ReadableStream({start(){opened();},cancel(){canceled=true;}}),{headers:{'Content-Type':'application/json'}}));
 const ctrl=new AbortController(),req=new Request(request(),{signal:ctrl.signal}),result=worker.fetch(req,env);await ready;ctrl.abort();assert.equal((await result).status,499);assert.equal(canceled,true);
});
const binaryRequest=(headers={},body=Buffer.from(input.image,'base64'),signal)=>new Request('https://pdf.test/api/ocr/vision',{method:'POST',headers:{'Content-Type':'image/jpeg','X-OCR-Consent':'true','X-OCR-Language':'kor+eng',...headers},body,signal});
test('binary transport keeps exact JPEG bytes, streams compact Google JSON, and never forwards the secret',async()=>{
 let sent;const raw=fixture(),worker=(await mod).createWorker(async(url,init)=>{sent={url,init};return Response.json(raw);});
 const response=await worker.fetch(binaryRequest(),env);
 assert.equal(response.headers.get('x-ocr-format'),'google-vision-v1');assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),raw);assert.equal(JSON.parse(sent.init.body).requests[0].image.content,input.image);
 const fields=new URL(sent.url).searchParams.get('fields');let depth=0;for(const char of fields){if(char==='(')depth++;if(char===')')depth--;assert.ok(depth>=0);}assert.equal(depth,0);
});
test('binary consent, language, JPEG header and length are checked before Google upload',async()=>{
 let calls=0;const worker=(await mod).createWorker(async()=>{calls++;throw Error('unexpected');});
 for(const [headers,body,status] of [[{'X-OCR-Consent':'false'},undefined,400],[{'X-OCR-Language':'invalid'},undefined,400],[{},Buffer.alloc(30),400],[{'Content-Length':String(6*1024*1024+1)},undefined,413],[{},Buffer.alloc(6*1024*1024+1),413]])assert.equal((await worker.fetch(binaryRequest(headers,body),env)).status,status);
 assert.equal(calls,0);
});
test('binary result stream cancellation aborts upstream after headers',async()=>{
 let canceled=false,signal;const worker=(await mod).createWorker(async(_url,init)=>{signal=init.signal;return new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'Content-Type':'application/json'}});});
 const ctrl=new AbortController(),response=await worker.fetch(binaryRequest({},undefined,ctrl.signal),env),reading=response.text();ctrl.abort();
 await assert.rejects(reading,{name:'AbortError'});assert.equal(signal.aborted,true);assert.equal(canceled,true);
});
test('binary response remains bounded with no Content-Length and rejects incomplete results',async()=>{
 let canceled=false;const worker=(await mod).createWorker(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(8*1024*1024+1));},cancel(){canceled=true;}}),{headers:{'Content-Type':'application/json'}}));
 const r=await worker.fetch(binaryRequest(),env);await assert.rejects(r.text(),e=>e.code==='VISION_RESULT_INVALID');assert.equal(canceled,true);
});
test('binary timeout covers a stalled response body, not only receiving headers',async()=>{
 const original=setTimeout,clear=clearTimeout;let timeout,canceled=false;
 global.setTimeout=(fn,ms)=>{assert.equal(ms,45000);timeout=fn;return 1;};global.clearTimeout=()=>{};
 try{const worker=(await mod).createWorker(async()=>new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'Content-Type':'application/json'}}));
 const r=await worker.fetch(binaryRequest(),env),reading=r.text();timeout();await assert.rejects(reading,e=>e.code==='VISION_TIMEOUT');assert.equal(canceled,true);
 }finally{global.setTimeout=original;global.clearTimeout=clear;}
});
