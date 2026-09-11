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
 assert.equal(sent.url,'https://vision.googleapis.com/v1/images:annotate');assert.equal(sent.init.headers['x-goog-api-key'],env.GOOGLE_VISION_API_KEY);assert.ok(!sent.url.includes(env.GOOGLE_VISION_API_KEY));
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
