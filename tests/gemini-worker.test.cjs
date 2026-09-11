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
test('Google configuration, quota and request failures are distinguishable without exposing upstream data',async()=>{
  const cases=[
    [400,'API_KEY_INVALID','API key not valid.',503,'GEMINI_KEY_INVALID'],
    [400,'','API key expired.',503,'GEMINI_KEY_INVALID'],
    [403,'','Your API key was reported as leaked.',503,'GEMINI_KEY_BLOCKED'],
    [403,'API_KEY_HTTP_REFERRER_BLOCKED','Requests are blocked.',503,'GEMINI_KEY_RESTRICTED'],
    [403,'SERVICE_DISABLED','Service disabled.',503,'GEMINI_API_DISABLED'],
    [429,'','Quota exceeded.',429,'GEMINI_QUOTA'],
    [400,'','User location is not supported for the API use.',503,'GEMINI_REGION'],
    [400,'','Gemini API free tier is not available in your country.',503,'GEMINI_FREE_TIER_UNAVAILABLE'],
    [404,'','Model missing.',503,'GEMINI_MODEL_UNAVAILABLE'],
    [403,'','Permission denied.',503,'GEMINI_PERMISSION'],
    [400,'','Invalid response_schema.',502,'GEMINI_REQUEST_SCHEMA'],
    [400,'','Invalid temperature.',502,'GEMINI_REQUEST_TEMPERATURE'],
    [400,'','Invalid image.',502,'GEMINI_REQUEST_IMAGE'],
    [400,'','Use interactions instead of generateContent.',502,'GEMINI_REQUEST_API'],
    [400,'','Invalid argument.',502,'GEMINI_REQUEST_INVALID'],
    [503,'','Service unavailable.',502,'GEMINI_UPSTREAM_503']
  ];
  for(const [status,reason,message,expectedStatus,code] of cases){
    let calls=0;
    const worker=(await mod).createWorker(async()=>{calls++;return Response.json({error:{message:message+' private-document '+env.GEMINI_API_KEY,details:[{reason,metadata:{image}}]}},{status});},async()=>{});
    const r=await worker.fetch(request(),env),data=await r.json();
    assert.equal(r.status,expectedStatus,code);assert.equal(data.code,code);assert.equal(calls,status===503?3:1);
    assert.equal(JSON.stringify(data).includes('private-document'),false);assert.equal(JSON.stringify(data).includes(env.GEMINI_API_KEY),false);
    assert.equal(r.headers.get('retry-after'),status===429?'60':null);
  }
});
test('temporary Google failures recover with backoff and every attempt consumes the shared rate limit',async()=>{
  let calls=0,limits=0;const delays=[],bodies=[];
  const worker=(await mod).createWorker(async(url,init)=>{calls++;bodies.push(init.body);return calls<3?new Response('unavailable',{status:503}):response();},async(ms)=>{delays.push(ms);});
  const r=await worker.fetch(request(),{...env,OCR_RATE_LIMIT:{limit:async()=>{limits++;return {success:true};}}});
  assert.equal(r.status,200);assert.deepEqual((await r.json()).lines,output.lines);assert.equal(calls,3);assert.equal(limits,3);
  assert.ok(delays[0]>=1000&&delays[0]<1250);assert.ok(delays[1]>=2000&&delays[1]<2250);assert.equal(new Set(bodies).size,1);
});
test('retries stop on cancellation, rate exhaustion and server cooldown',async()=>{
  let calls=0,limits=0;
  const limited=(await mod).createWorker(async()=>{calls++;return new Response('',{status:503});},async()=>{});
  const r=await limited.fetch(request(),{...env,OCR_RATE_LIMIT:{limit:async()=>({success:++limits===1})}});
  assert.equal(r.status,429);assert.equal(calls,1);assert.equal(limits,2);
  for(const retryAfter of ['60',new Date(Date.now()+60000).toUTCString()]){
    calls=0;
    const cooldown=(await mod).createWorker(async()=>{calls++;return new Response('',{status:503,headers:{'Retry-After':retryAfter}});},async()=>assert.fail('must honor long cooldown'));
    assert.equal((await cooldown.fetch(request(),env)).status,502);assert.equal(calls,1);
  }
  calls=0;const ctrl=new AbortController();
  const cancelled=(await mod).createWorker(async()=>{calls++;return new Response('',{status:503});},async()=>{ctrl.abort();});
  const req=new Request(request(),{signal:ctrl.signal});
  assert.equal((await cancelled.fetch(req,env)).status,504);assert.equal(calls,1);
});
test('configured backup is used only after two 503 responses and reports the actual model',async()=>{
  const urls=[],backupEnv={...env,GEMINI_FALLBACK_MODEL:'gemini-3.7-flash'};
  const worker=(await mod).createWorker(async(url)=>{urls.push(url);return urls.length<3?new Response('',{status:503}):response();},async()=>{});
  const r=await worker.fetch(request(),backupEnv);
  assert.equal(r.status,200);assert.equal((await r.json()).model,'gemini-3.7-flash');
  assert.deepEqual(urls.map(url=>url.match(/models\/([^:]+)/)[1]),['gemini-3.8-flash','gemini-3.8-flash','gemini-3.7-flash']);
  let calls=0;
  const quota=(await mod).createWorker(async()=>{calls++;return new Response('',{status:429});},async()=>assert.fail('quota must not retry'));
  assert.equal((await quota.fetch(request(),backupEnv)).status,429);assert.equal(calls,1);
});
test('non-JSON and oversized Google errors use bounded safe fallbacks',async()=>{
  for(const body of ['<html>private upstream detail</html>',JSON.stringify({error:{message:'x'.repeat(70000)}})]){
    const worker=(await mod).createWorker(async()=>new Response(body,{status:400}));
    const r=await worker.fetch(request(),env),data=await r.json();
    assert.equal(r.status,502);assert.equal(data.code,'GEMINI_REQUEST_INVALID');assert.ok(JSON.stringify(data).length<300);
  }
});
test('unknown API paths return JSON; static files use asset binding',async()=>{
  const worker=(await mod).createWorker(()=>{throw Error('unexpected upstream');});
  assert.equal((await worker.fetch(new Request('https://pdf.hanatrust.workers.dev/api/unknown'),env)).status,404);
  assert.equal(await(await worker.fetch(new Request('https://pdf.hanatrust.workers.dev/'),{ASSETS:{fetch:async()=>new Response('PDF Studio')}})).text(),'PDF Studio');
});

test('Gemini 3 uses supported low-latency settings without forcing zero temperature',async()=>{
  for(const [model,thinking,temperature] of [['gemini-3.8-flash','low',undefined],['gemini-3.7-flash','low',undefined],['gemini-3.1-pro-preview',undefined,undefined],['gemini-2.5-flash',undefined,0]]){
    let config;
    const worker=(await mod).createWorker(async(url,init)=>{config=JSON.parse(init.body).generationConfig;return response();});
    assert.equal((await worker.fetch(request(),{...env,GEMINI_MODEL:model})).status,200);
    assert.equal(config.thinkingConfig?.thinkingLevel,thinking,model);assert.equal(config.temperature,temperature,model);
    assert.equal(config.maxOutputTokens,16384);assert.equal(config.responseMimeType,'application/json');
  }
});

test('fallback rebuilds model-specific settings and never switches on a credential error',async()=>{
  const sent=[];
  const worker=(await mod).createWorker(async(url,init)=>{sent.push(JSON.parse(init.body).generationConfig);return sent.length<3?new Response('',{status:503}):response();},async()=>{});
  const r=await worker.fetch(request(),{...env,GEMINI_FALLBACK_MODEL:'gemini-2.5-flash'});
  assert.equal(r.status,200);assert.equal(sent[0].thinkingConfig.thinkingLevel,'low');
  assert.equal(sent[2].thinkingConfig,undefined);assert.equal(sent[2].temperature,0);
  let calls=0;
  const invalid=(await mod).createWorker(async()=>{calls++;return Response.json({error:{details:[{reason:'API_KEY_INVALID'}]}},{status:503});},async()=>assert.fail('credential failure must not retry'));
  assert.equal((await(await invalid.fetch(request(),env)).json()).code,'GEMINI_KEY_INVALID');assert.equal(calls,1);
});

test('structured output ignores thought parts and joins split JSON without reordering columns',async()=>{
  const lines=[{text:'왼쪽 열 위',box:[100,100,130,300],uncertain:false},{text:'왼쪽 열 아래',box:[400,100,430,300],uncertain:true},{text:'오른쪽 열 위',box:[100,600,130,900],uncertain:false}],encoded=JSON.stringify({lines});
  const worker=(await mod).createWorker(async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'private reasoning, not JSON'},{text:encoded.slice(0,23)},{thoughtSignature:'private signature'},{text:encoded.slice(23)}]}}]}));
  const r=await worker.fetch(request(),env);assert.equal(r.status,200);assert.deepEqual((await r.json()).lines,lines);
  const blank=(await mod).createWorker(async()=>response({lines:[]}));
  assert.deepEqual((await(await blank.fetch(request(),env)).json()).lines,[]);
});

test('blocked, incomplete and truncated results give distinct errors and no partial lines',async()=>{
  const cases=[
    [{promptFeedback:{blockReason:'SAFETY'}},422,'GEMINI_CONTENT_BLOCKED'],
    [{candidates:[{finishReason:'SPII'}]},422,'GEMINI_CONTENT_BLOCKED'],
    [{candidates:[{finishReason:'RECITATION'}]},422,'GEMINI_RECITATION'],
    [{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(output)}]}}]},502,'GEMINI_RESULT_TRUNCATED'],
    [{candidates:[{finishReason:'OTHER'}]},502,'GEMINI_RESULT_INCOMPLETE'],
    [{candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:JSON.stringify(output)}]}}]},502,'GEMINI_RESULT_INVALID'],
    [{candidates:[]},502,'GEMINI_RESULT_INCOMPLETE']
  ];
  for(const [value,status,code] of cases){
    let calls=0;const worker=(await mod).createWorker(async()=>{calls++;return Response.json(value);});
    const r=await worker.fetch(request(),env),data=await r.json();
    assert.equal(r.status,status);assert.equal(data.code,code);assert.equal(data.lines,undefined);assert.equal(calls,1);
  }
});

test('provider cooldown uses the longest Retry-After or RetryInfo delay without automatic quota retry',async()=>{
  for(const [header,delay,seconds] of [['120','40.2s',120],['2','15.2s',16],[null,'0.1s',1],['invalid','invalid',60]]){
    let calls=0;
    const worker=(await mod).createWorker(async()=>{calls++;return Response.json({error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:delay}]}},{status:429,headers:header?{'Retry-After':header}:{}});});
    const r=await worker.fetch(request(),env),data=await r.json();
    assert.equal(r.status,429);assert.equal(data.retryAfter,seconds);assert.equal(r.headers.get('retry-after'),String(seconds));assert.equal(calls,1);
  }
  const worker=(await mod).createWorker(async()=>{throw Error('unexpected upstream');});
  const r=await worker.fetch(request(),{...env,OCR_RATE_LIMIT:{limit:async()=>({success:false})}}),data=await r.json();
  assert.equal(data.code,'GEMINI_RATE_LIMIT');assert.equal(data.retryAfter,60);
});

test('long provider RetryInfo cooldown prevents availability retry and reaches the client',async()=>{
  let calls=0;
  const worker=(await mod).createWorker(async()=>{calls++;return Response.json({error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'30s'}]}},{status:503});},async()=>assert.fail('must not retry before cooldown'));
  const r=await worker.fetch(request(),env),data=await r.json();
  assert.equal(r.status,502);assert.equal(data.code,'GEMINI_UPSTREAM_503');assert.equal(data.retryAfter,30);assert.equal(r.headers.get('retry-after'),'30');assert.equal(calls,1);
});

test('slow availability failures stop before a retry with no useful deadline remaining',async()=>{
  let now=0,calls=0,limits=0;
  const worker=(await mod).createWorker(async()=>{calls++;now=78000;return new Response('',{status:503});},async()=>assert.fail('must not spend the remaining deadline waiting'),()=>now);
  const r=await worker.fetch(request(),{...env,OCR_RATE_LIMIT:{limit:async()=>{limits++;return {success:true};}}});
  assert.equal(r.status,502);assert.equal(calls,1);assert.equal(limits,1);
});

test('cancelling after response headers cancels a pending body read and never returns OCR output',async()=>{
  for(const upstreamStatus of [200,503]){
    let began,cancelled=0,calls=0;
    const reading=new Promise(resolve=>{began=resolve;});
    const stream=new ReadableStream({pull(){began();return new Promise(()=>{});},cancel(){cancelled++;}},{highWaterMark:0});
    const ctrl=new AbortController(),worker=(await mod).createWorker(async()=>{calls++;return new Response(stream,{status:upstreamStatus});});
    const pending=worker.fetch(new Request(request(),{signal:ctrl.signal}),env);
    await reading;ctrl.abort();
    const r=await pending,data=await r.json();
    assert.equal(r.status,504);assert.equal(data.code,'GEMINI_CANCELLED');assert.equal(data.lines,undefined);assert.equal(cancelled,1);assert.equal(calls,1);
  }
});

test('the shared timeout also terminates a stalled response body after headers',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let began,cancelled=0;
  const reading=new Promise(resolve=>{began=resolve;});
  const stream=new ReadableStream({pull(){began();return new Promise(()=>{});},cancel(){cancelled++;}},{highWaterMark:0});
  const worker=(await mod).createWorker(async()=>new Response(stream)),pending=worker.fetch(request(),env);
  await reading;t.mock.timers.tick(80000);
  const r=await pending,data=await r.json();
  assert.equal(r.status,504);assert.equal(data.code,'GEMINI_TIMEOUT');assert.equal(data.lines,undefined);assert.equal(cancelled,1);
});

test('invalid and oversized successful provider responses are upstream failures, not invalid user requests',async()=>{
  for(const [value,code] of [['<html>private provider response</html>','GEMINI_RESULT_INVALID'],['x'.repeat(2*1024*1024+1),'GEMINI_RESULT_TOO_LARGE']]){
    const worker=(await mod).createWorker(async()=>new Response(value));
    const r=await worker.fetch(request(),env),data=await r.json();
    assert.equal(r.status,502);assert.equal(data.code,code);assert.equal(data.lines,undefined);assert.ok(JSON.stringify(data).length<300);
  }
});
