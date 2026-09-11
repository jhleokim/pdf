const test=require('node:test'),assert=require('node:assert/strict');
const {createHash,webcrypto}=require('node:crypto');
const {pathToFileURL}=require('node:url'),path=require('node:path');

// No model weights, browser automation, or real network are used in this suite.
// Relevant platform contracts:
// https://w3c.github.io/ServiceWorker/#cache-put (206 cannot be put directly)
// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest (not streaming)
const modulePromise=import(pathToFileURL(path.join(__dirname,'../src/paddle/web-assets.mjs')).href);
const BASE='https://pdf.example.test/paddle/pinned/';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();}throw Error('Controlled operation did not start');}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const aborted=error=>error?.name==='AbortError';

function fixture(revision,parts=[Uint8Array.of(10,20,30,40),Uint8Array.of(50,60,70)]){
  const all=Uint8Array.from(parts.flatMap(part=>[...part]));
  return {parts,all,manifest:{schemaVersion:1,model:'onnx-community/PaddleOCR-VL-1.5-ONNX',revision,chunkSize:4,totalSize:all.length,
    assets:[{path:'onnx/embedding.onnx.data',size:all.length,sha256:hash(all),chunks:parts.map((bytes,index)=>({file:'embedding-'+index+'.bin',size:bytes.length,sha256:hash(bytes)}))}]}};
}

function memoryCache(options={}){
  const stores=new Map(),events=[];
  const api={async open(name){events.push({action:'open',name});if(options.openError)throw options.openError;
    if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);
    return {
      async match(request){const url=String(request.url||request);events.push({action:'match',name,url});if(options.matchError)throw options.matchError;return entries.get(url)?.clone();},
      async put(request,response){const url=String(request.url||request);events.push({action:'put',name,url,status:response.status});if(options.putError)throw options.putError;
        assert.equal(response.status,200,'only verified full chunk bodies are persisted as 200 Responses');entries.set(url,response.clone());},
      async delete(request){const url=String(request.url||request);events.push({action:'delete',name,url});return entries.delete(url);},
    };
  }};
  return {api,stores,events};
}

async function harness(options={}){
  const {createPaddleAssets,PINNED_REVISION}=await modulePromise;
  const data=options.fixture||fixture(PINNED_REVISION),cache=options.cache||memoryCache(options.cacheOptions),calls=[],digests=[],progress=[];
  const byURL=new Map(data.manifest.assets.flatMap(asset=>asset.chunks.map((chunk,index)=>[new URL(chunk.file,BASE).href,data.parts[index]])));
  const fetchImpl=async(url,init={})=>{const call={url:String(url),init};calls.push(call);
    assert.equal(init.method||'GET','GET','asset transport must never POST page data');assert.equal(init.body,undefined,'asset transport has no document/image body');
    assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-cache');
    assert.equal(new URL(call.url).origin,new URL(BASE).origin,'all chunks stay on the configured asset origin');
    assert.ok(byURL.has(call.url),'only declared model chunks may be requested');
    if(options.fetch)return options.fetch(call,data,calls);
    return new Response(byURL.get(call.url),{headers:{'Content-Length':String(byURL.get(call.url).length)}});
  };
  const subtle={async digest(algorithm,bytes){digests.push({algorithm,size:bytes.byteLength,bytes:[...new Uint8Array(bytes.buffer||bytes,bytes.byteOffset||0,bytes.byteLength)]});
    return options.digest?options.digest(algorithm,bytes):webcrypto.subtle.digest(algorithm,bytes);}};
  const api=createPaddleAssets({manifest:data.manifest,baseURL:BASE,fetchImpl,cacheStorage:options.noCache?undefined:cache.api,subtle,expectedRevision:options.expectedRevision??PINNED_REVISION});
  const load=(signal)=>api.loadAsset('onnx/embedding.onnx.data',signal,value=>progress.push(value));
  return {api,load,data,cache,calls,digests,progress,createPaddleAssets,PINNED_REVISION};
}

test('verified chunks reconstruct bytes with GET-only transport and bounded hash input',async()=>{
  const h=await harness(),bytes=await h.load();
  assert.deepEqual([...bytes],[...h.data.all]);assert.equal(h.calls.length,2);
  assert.ok(h.digests.length>=2);assert.ok(h.digests.every(item=>item.size<=h.data.manifest.chunkSize),'SHA input is one chunk, never the whole asset');
  assert.equal(h.cache.events.filter(item=>item.action==='put').length,2);
  assert.ok(h.cache.events.filter(item=>item.action==='open').every(item=>item.name.includes(h.PINNED_REVISION)),'persistent cache belongs to the pinned model revision');
  assert.equal(h.calls.some(call=>/ocr|gemini|recognize/i.test(new URL(call.url).pathname)),false);
});

test('new loader and repeated calls reuse independently reverified cache chunks',async()=>{
  const first=await harness();await first.load();const second=await harness({cache:first.cache});
  assert.deepEqual([...await second.load()],[...first.data.all]);assert.deepEqual([...await second.load()],[...first.data.all]);
  assert.equal(second.calls.length,0);assert.equal(second.digests.length,4,'both calls recheck both cached chunk bodies');
});

test('a different pinned model revision cannot reuse a previous revision cache',async()=>{
  const first=await harness();await first.load();
  const revision='a'.repeat(40),nextData=fixture(revision,[Uint8Array.of(90,91,92,93),Uint8Array.of(94,95,96)]);
  const next=await harness({cache:first.cache,fixture:nextData,expectedRevision:revision});
  assert.deepEqual([...await next.load()],[...nextData.all]);assert.equal(next.calls.length,2);
  assert.equal(first.cache.stores.size,2,'each pinned revision has a distinct cache namespace');
});

test('same-length corrupt cache is deleted and repaired by one network read',async()=>{
  const first=await harness();await first.load();
  const entries=[...first.cache.stores.values()][0],url=new URL(first.data.manifest.assets[0].chunks[0].file,BASE).href;
  entries.set(url,new Response(Uint8Array.of(99,20,30,40)));
  const next=await harness({cache:first.cache});assert.deepEqual([...await next.load()],[...first.data.all]);
  assert.equal(next.calls.length,1);assert.equal(next.calls[0].url,url);
  assert.ok(first.cache.events.some(item=>item.action==='delete'&&item.url===url));
  assert.deepEqual([...new Uint8Array(await entries.get(url).clone().arrayBuffer())],[10,20,30,40]);
});

test('a cache length mismatch is never trusted even when a cached digest header claims validity',async()=>{
  const first=await harness();await first.load();const entries=[...first.cache.stores.values()][0],chunk=first.data.manifest.assets[0].chunks[1],url=new URL(chunk.file,BASE).href;
  entries.set(url,new Response(Uint8Array.of(50,60),{headers:{'X-SHA256':chunk.sha256,'Content-Length':'3'}}));
  const next=await harness({cache:first.cache});assert.deepEqual([...await next.load()],[...first.data.all]);assert.equal(next.calls.length,1);
});

test('CacheStorage SecurityError, read failure, and quota refusal do not prevent verified loading',async()=>{
  for(const cacheOptions of [{openError:new DOMException('Unavailable','SecurityError')},{matchError:Error('Cache read failed')},{putError:new DOMException('Full','QuotaExceededError')}]){
    const h=await harness({cacheOptions});assert.deepEqual([...await h.load()],[...h.data.all]);assert.equal(h.calls.length,2);
  }
  const without=await harness({noCache:true});assert.deepEqual([...await without.load()],[...without.data.all]);assert.equal(without.calls.length,2);
});

test('bad network digest rejects without poisoning cache and a later load retries',async()=>{
  let damage=true;
  const h=await harness({fetch:async(call,data)=>{const index=call.url.endsWith('0.bin')?0:1;return new Response(index===1&&damage?Uint8Array.of(51,60,70):data.parts[index]);}});
  await assert.rejects(h.load());assert.equal(h.calls.length,2);
  assert.equal(h.cache.events.filter(item=>item.action==='put').length,1,'completed first chunk survives, corrupt second is not published');
  damage=false;assert.deepEqual([...await h.load()],[...h.data.all]);assert.equal(h.calls.length,3,'retry fetches only the unfinished second chunk');
});

test('HTTP failure is not persisted and does not leave a rejected promise blocking retry',async()=>{
  let fail=true;
  const h=await harness({fetch:async(call,data)=>{if(fail){fail=false;return new Response('temporary',{status:503});}return new Response(data.parts[call.url.endsWith('0.bin')?0:1]);}});
  await assert.rejects(h.load());assert.equal(h.cache.events.filter(item=>item.action==='put').length,0);
  assert.deepEqual([...await h.load()],[...h.data.all]);assert.equal(h.calls.length,3);
});

test('oversized body without Content-Length is canceled instead of fully consumed or cached',async()=>{
  let canceled=false,pulls=0;
  const h=await harness({fetch:async()=>new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(Uint8Array.of(1,2,3,4,5));},cancel(){canceled=true;}},{highWaterMark:0}))});
  await assert.rejects(h.load());assert.equal(canceled,true);assert.equal(pulls,1);assert.equal(h.calls.length,1);
  assert.equal(h.cache.events.filter(item=>item.action==='put').length,0);
});

test('truncated body and false Content-Length reject and remain retryable',async()=>{
  for(const response of [()=>new Response(Uint8Array.of(10,20,30)),()=>new Response(Uint8Array.of(10,20,30,40),{headers:{'Content-Length':'5'}})]){
    let malformed=true;const h=await harness({fetch:async(call,data)=>malformed?response():new Response(data.parts[call.url.endsWith('0.bin')?0:1])});
    await assert.rejects(h.load());assert.equal(h.cache.events.filter(item=>item.action==='put').length,0);
    malformed=false;assert.deepEqual([...await h.load()],[...h.data.all]);
  }
});

test('already canceled loading performs no cache lookup, digest, or network request',async()=>{
  const h=await harness(),controller=new AbortController();controller.abort();await assert.rejects(h.load(controller.signal),aborted);
  assert.equal(h.calls.length,0);assert.equal(h.digests.length,0);assert.equal(h.cache.events.filter(item=>item.action==='match').length,0);
});

test('canceling a stalled body closes its reader and a new call can retry',async()=>{
  let pulled=false,canceled=false,stall=true;
  const h=await harness({fetch:async(call,data)=>stall?new Response(new ReadableStream({pull(){pulled=true;},cancel(){canceled=true;}},{highWaterMark:0})):new Response(data.parts[call.url.endsWith('0.bin')?0:1])});
  const controller=new AbortController(),pending=h.load(controller.signal),rejected=assert.rejects(pending,aborted);
  await until(()=>pulled);controller.abort();await rejected;assert.equal(canceled,true);
  assert.equal(h.cache.events.filter(item=>item.action==='put').length,0);stall=false;
  assert.deepEqual([...await h.load()],[...h.data.all]);
});

test('cancellation while digest is pending never publishes a partial success',async()=>{
  let release,started=false;
  const h=await harness({digest:async(algorithm,bytes)=>{started=true;await new Promise(resolve=>{release=resolve;});return webcrypto.subtle.digest(algorithm,bytes);}});
  const controller=new AbortController(),pending=h.load(controller.signal),rejected=assert.rejects(pending,aborted);
  await until(()=>started);controller.abort();release();await rejected;assert.equal(h.calls.length,1);
  assert.equal(h.cache.events.filter(item=>item.action==='put').length,0);
});

test('cancellation from the final progress callback rejects instead of returning success',async()=>{
  const h=await harness(),controller=new AbortController();let count=0;
  await assert.rejects(h.api.loadAsset('onnx/embedding.onnx.data',controller.signal,()=>{if(++count===2)controller.abort();}),aborted);
  assert.equal(count,2);
});

test('one caller aborting does not cancel another caller through a shared pending promise',async()=>{
  const waiting=[];
  const h=await harness({fixture:fixture((await modulePromise).PINNED_REVISION,[Uint8Array.of(1,2,3)]),fetch:(call,data)=>new Promise((resolve,reject)=>{
    waiting.push(()=>resolve(new Response(data.parts[0])));call.init.signal?.addEventListener('abort',()=>reject(call.init.signal.reason),{once:true});
  })});
  const one=new AbortController(),two=new AbortController();const a=h.load(one.signal),rejectA=assert.rejects(a,aborted),b=h.load(two.signal);
  await until(()=>waiting.length===2);one.abort();waiting[1]();await rejectA;assert.deepEqual([...await b],[1,2,3]);
  assert.equal(two.signal.aborted,false);
});

test('unknown asset paths cannot trigger document upload or arbitrary fetch',async()=>{
  const h=await harness();
  for(const asset of ['scan.pdf','../document.pdf','https://outside.test/a.bin','onnx/embedding.onnx.data?document=secret'])await assert.rejects(h.api.loadAsset(asset));
  assert.equal(h.calls.length,0);
});

test('malformed or unpinned manifests fail before any transport',async()=>{
  const {createPaddleAssets,PINNED_REVISION}=await modulePromise;
  const mutations=[
    m=>{m.schemaVersion=2;},m=>{m.model='unapproved/model';},m=>{m.revision='main';},
    m=>{m.chunkSize=25*1024*1024+1;},m=>{m.chunkSize=0;},m=>{m.chunkSize=3;},m=>{m.totalSize++;},
    m=>{m.assets[0].size++;},m=>{m.assets[0].chunks[0].size=5;},m=>{m.assets[0].chunks[0].sha256='g'.repeat(64);},
    m=>{m.assets.push(structuredClone(m.assets[0]));m.totalSize*=2;},
    ...['../outside.bin','https://outside.test/a.bin','//outside.test/a.bin','x.bin?document=secret','x.bin#part','%2e%2e%2foutside.bin','x%5coutside.bin'].map(file=>m=>{m.assets[0].chunks[0].file=file;}),
  ];
  for(const [index,mutate] of mutations.entries()){const {manifest}=fixture(PINNED_REVISION);mutate(manifest);let calls=0;
    await assert.rejects(async()=>{const api=createPaddleAssets({manifest,baseURL:BASE,expectedRevision:PINNED_REVISION,fetchImpl:async()=>{calls++;throw Error('Unexpected transport');},cacheStorage:undefined,subtle:webcrypto.subtle});await api.loadAsset('onnx/embedding.onnx.data');});
    assert.equal(calls,0,'invalid manifest #'+index+' must be rejected before fetch');
  }
});

test('mutating caller-owned manifest after construction cannot redirect a model request',async()=>{
  const h=await harness();h.data.manifest.assets[0].chunks[0].file='https://outside.test/collect?document=secret';
  try{const result=await h.load();assert.deepEqual([...result],[...h.data.all]);}catch(error){assert.equal(h.calls.length,0,'loader must snapshot the manifest or reject the mutation before transport');}
  assert.ok(h.calls.every(call=>call.url.startsWith(BASE)));
});
