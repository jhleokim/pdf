const test=require('node:test'),assert=require('node:assert/strict');
const mod=import('../server/worker.mjs');
const image='/9j/'+Buffer.alloc(16).toString('base64'),input={consent:true,language:'kor+eng',mimeType:'image/jpeg',image};
const request=(body=input,headers={})=>new Request('https://pdf.hanatrust.workers.dev/api/ocr/gemini',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://pdf.hanatrust.workers.dev',...headers},body:JSON.stringify(body)});
const env={GEMINI_API_KEY:'test-secret-never-return',OCR_RATE_LIMIT:{limit:async()=>({success:true})}};
const output={lines:[{text:'계약 금액 123,450원',box:[100,100,140,600],uncertain:false}]};
const response=(value=output,finishReason='STOP')=>Response.json({candidates:[{finishReason,content:{parts:[{text:JSON.stringify(value)}]}}]});
test('consent and valid image are required before any upstream call',async()=>{
  let calls=0;const worker=(await mod).createWorker(async()=>{calls++;return response();});
  for(const body of [{...input,consent:false},{...input,consent:'true'},{...input,image:'bad'},{...input,language:'invalid'}])assert.equal((await worker.fetch(request(body),env)).status,400);
  assert.equal(calls,0);
});
test('missing secret, wrong origin, content type and excessive body do not call Gemini',async()=>{
  let calls=0;const worker=(await mod).createWorker(async()=>{calls++;return response();});
  assert.equal((await worker.fetch(request(),{})).status,503);
  assert.equal((await worker.fetch(request(input,{Origin:'https://attacker.example'}),env)).status,403);
  assert.equal((await worker.fetch(request(input,{'Content-Type':'text/plain'}),env)).status,415);
  assert.equal((await worker.fetch(request(input,{'Content-Length':String(9*1024*1024)}),env)).status,413);
  assert.equal(calls,0);
});
test('status exposes only availability; standalone preflight permits null origin',async()=>{
  const worker=(await mod).createWorker(()=>{throw Error('unexpected upstream');});
  const r=await worker.fetch(new Request('https://pdf.hanatrust.workers.dev/api/ocr/gemini'),env);
  assert.deepEqual(await r.json(),{available:true});assert.equal(r.headers.get('cache-control'),'no-store');
  const preflight=await worker.fetch(new Request('https://pdf.hanatrust.workers.dev/api/ocr/gemini',{method:'OPTIONS',headers:{Origin:'null'}}),env);
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'null');
});
test('Google receives only image and controlled instructions; result contains no key or invented confidence',async()=>{
  let sent;const worker=(await mod).createWorker(async(url,init)=>{sent={url,init};return response();});
  const r=await worker.fetch(request(),env),data=await r.json();
  assert.equal(r.status,200);assert.deepEqual(data.lines,output.lines);assert.equal(JSON.stringify(data).includes(env.GEMINI_API_KEY),false);
  assert.equal(sent.init.headers['x-goog-api-key'],env.GEMINI_API_KEY);assert.equal(sent.url.includes(env.GEMINI_API_KEY),false);
  const body=JSON.parse(sent.init.body);assert.equal(body.contents[0].parts[1].inlineData.data,image);assert.equal(body.generationConfig.responseMimeType,'application/json');
});
test('rate limit and upstream 429 return controlled errors without auto retry',async()=>{
  let calls=0;const worker=(await mod).createWorker(async()=>{calls++;return new Response('private upstream detail',{status:429});});
  assert.equal((await worker.fetch(request(),{...env,OCR_RATE_LIMIT:{limit:async()=>({success:false})}})).status,429);assert.equal(calls,0);
  const r=await worker.fetch(request(),env);assert.equal(r.status,429);assert.equal((await r.text()).includes('private upstream detail'),false);assert.equal(calls,1);
});
test('truncated and invalid OCR results are rejected instead of silently saved',async()=>{
  for(const [value,reason] of [[output,'MAX_TOKENS'],[{lines:[{...output.lines[0],box:[140,100,100,600]}]},'STOP'],[{lines:[{...output.lines[0],box:[0,0,1001,600]}]},'STOP'],[{lines:[{...output.lines[0],text:'\u0000'}]},'STOP']]){
    const worker=(await mod).createWorker(async()=>response(value,reason));assert.equal((await worker.fetch(request(),env)).status,502);
  }
});
test('unknown API paths return JSON; static files use asset binding',async()=>{
  const worker=(await mod).createWorker(()=>{throw Error('unexpected upstream');});
  assert.equal((await worker.fetch(new Request('https://pdf.hanatrust.workers.dev/api/unknown'),env)).status,404);
  assert.equal(await(await worker.fetch(new Request('https://pdf.hanatrust.workers.dev/'),{ASSETS:{fetch:async()=>new Response('PDF Studio')}})).text(),'PDF Studio');
});
