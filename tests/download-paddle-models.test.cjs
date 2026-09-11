const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const modulePromise=import('../scripts/download-paddle-models.mjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function fixture(t){
  const outputDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'paddle-download-test-'));
  t.after(()=>{
    const resolved=path.resolve(outputDirectory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('paddle-download-test-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  const bytes=Buffer.from('abcdefghijk');
  return {bytes,options:{outputDirectory,asset:{path:'test.onnx',size:bytes.length,sha256:hash(bytes)},rangeSize:4,retryMs:0}};
}

function rangeResponse(bytes,request){
  const [,first,last]=/^bytes=(\d+)-(\d+)$/.exec(request.headers.Range),start=Number(first),end=Number(last);
  return new Response(bytes.subarray(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});
}

test('ranged source download verifies exact bytes before publishing',async t=>{
  const {downloadVerifiedFile}=await modulePromise,{bytes,options}=fixture(t),requests=[];
  const file=await downloadVerifiedFile({...options,fetchImpl:async(url,request)=>{
    assert.ok(url.startsWith('https://huggingface.co/onnx-community/PaddleOCR-VL-1.5-ONNX/resolve/ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4/test.onnx?'));
    requests.push(request.headers.Range);return rangeResponse(bytes,request);
  }});
  assert.deepEqual(fs.readFileSync(file),bytes);
  assert.deepEqual(requests.sort(),['bytes=0-3','bytes=4-7','bytes=8-10']);
  assert.deepEqual(fs.readdirSync(options.outputDirectory),['test.onnx']);
});

test('transient range errors retry within three attempts',async t=>{
  const {downloadVerifiedFile}=await modulePromise,{bytes,options}=fixture(t),counts=new Map();
  await downloadVerifiedFile({...options,fetchImpl:async(url,request)=>{
    const range=request.headers.Range,count=(counts.get(range)||0)+1;counts.set(range,count);
    return count===1?new Response('temporary',{status:503}):rangeResponse(bytes,request);
  }});
  assert.deepEqual([...counts.values()],[2,2,2]);
});

test('servers that ignore Range are rejected without accepting a full oversized body',async t=>{
  const {downloadVerifiedFile}=await modulePromise,{bytes,options}=fixture(t);let calls=0;
  await assert.rejects(downloadVerifiedFile({...options,concurrency:1,fetchImpl:async()=>{calls++;return new Response(bytes,{status:200});}}),/HTTP 200/);
  assert.equal(calls,3);assert.deepEqual(fs.readdirSync(options.outputDirectory),[]);
});

test('wrong ranges and body overflows cannot produce a source file',async t=>{
  const {downloadVerifiedFile}=await modulePromise,{options}=fixture(t);
  await assert.rejects(downloadVerifiedFile({...options,maxAttempts:1,concurrency:1,fetchImpl:async()=>new Response('abcd',{status:206,headers:{'Content-Range':'bytes 1-4/11'}})}),/Content-Range/);
  await assert.rejects(downloadVerifiedFile({...options,maxAttempts:1,concurrency:1,fetchImpl:async()=>new Response('abcde',{status:206,headers:{'Content-Range':'bytes 0-3/11'}})}),/exceeds the requested range/);
  assert.deepEqual(fs.readdirSync(options.outputDirectory),[]);
});

test('whole-file hash mismatch preserves the previous target and removes partial data',async t=>{
  const {downloadVerifiedFile}=await modulePromise,{bytes,options}=fixture(t),target=path.join(options.outputDirectory,'test.onnx');
  fs.writeFileSync(target,'previous');const changed=Buffer.from(bytes);changed[8]=90;
  await assert.rejects(downloadVerifiedFile({...options,fetchImpl:async(url,request)=>rangeResponse(changed,request)}),/SHA256 mismatch/);
  assert.equal(fs.readFileSync(target,'utf8'),'previous');
  assert.deepEqual(fs.readdirSync(options.outputDirectory),['test.onnx']);
});

test('stalled fetches are aborted with a bounded retry count',async t=>{
  const {downloadVerifiedFile}=await modulePromise,{options}=fixture(t);let calls=0;
  await assert.rejects(downloadVerifiedFile({...options,concurrency:1,maxAttempts:2,timeoutMs:10,fetchImpl:async(url,{signal})=>{
    calls++;return new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  }}),error=>error.name==='TimeoutError');
  assert.equal(calls,2);assert.deepEqual(fs.readdirSync(options.outputDirectory),[]);
});

test('the request deadline also cancels a body stalled after its headers',async t=>{
  const {downloadVerifiedFile}=await modulePromise,{options}=fixture(t);let cancelled=false;
  await assert.rejects(downloadVerifiedFile({...options,concurrency:1,maxAttempts:1,timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({
    start(controller){controller.enqueue(Uint8Array.of(97,98));},cancel(){cancelled=true;}
  }),{status:206,headers:{'Content-Range':'bytes 0-3/11'}})}),error=>error.name==='TimeoutError');
  assert.equal(cancelled,true);assert.deepEqual(fs.readdirSync(options.outputDirectory),[]);
});
