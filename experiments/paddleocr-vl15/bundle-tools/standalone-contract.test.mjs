import assert from 'node:assert/strict';
import vm from 'node:vm';
import {standaloneLoaderSource,adaptHarness,bundleBrowser,ROOT} from '../build-standalone.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const files=[
  ['models/paddle-vl15-community/onnx/embedding.onnx',Uint8Array.from([0,1,2,127,128,254,255])],
  ['models/paddle-vl15-community/tokenizer_config.json',new TextEncoder().encode('{"works":true}')],
  ['fixtures/test.png',Uint8Array.from([1,2,3,4])],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs',new TextEncoder().encode('export default {};')],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',Uint8Array.from([0,97,115,109])],
];
const nodes=new Map(),assets=[];let removed=0;
files.forEach(([path,bytes],index)=>{
  const id='x'+index;let chunks=0;
  for(let i=0;i<bytes.length;i+=3){const key=id+'-'+chunks++;nodes.set(key,{textContent:Buffer.from(bytes.slice(i,i+3)).toString('base64'),remove(){nodes.delete(key);removed++;}});}
  assets.push({id,path,size:bytes.length,chunks,mime:path.endsWith('.mjs')?'text/javascript':'application/octet-stream'});
});
let networkCalls=0;
const context=vm.createContext({URL,Blob,Uint8Array,TextDecoder,TextEncoder,Map,Set,Promise,Error,Math,JSON,String,atob,setTimeout,
  location:{href:'file:///paddle.html'},window:{addEventListener(){}},document:{getElementById:id=>nodes.get(id)||null},
  fetch:(...args)=>{networkCalls++;return fetch(...args);}});
vm.runInContext(standaloneLoaderSource({assets,modelBytes:0}),context);
const loader=context.PaddleStandalone;
const first=await loader.loadAsset('onnx/embedding.onnx');
assert.deepEqual([...first],[0,1,2,127,128,254,255]);
const removedAfterFirst=removed;
assert.equal(await loader.loadAsset('./models/paddle-vl15-community/onnx/embedding.onnx'),first,'same cached bytes enable a second session');
assert.equal(removed,removedAfterFirst,'cached request does not reread removed Base64 DOM');
assert.equal((await loader.loadAsset('tokenizer_config.json','json')).works,true);
assert.equal((await loader.loadAsset('tokenizer_config.json','json')).works,true);
const png=await loader.loadAsset('fixtures/test.png','url');assert.ok(png.startsWith('blob:'));
assert.equal(await loader.loadAsset('fixtures/test.png','url'),png);
assert.deepEqual([...await loader.loadAsset('fixtures/test.png')],[1,2,3,4]);
const ort={env:{wasm:{}}};await loader.configureORT(ort);
assert.ok(ort.env.wasm.wasmPaths.mjs.startsWith('blob:'));assert.ok(ort.env.wasm.wasmPaths.wasm.startsWith('blob:'));
assert.equal(ort.env.wasm.numThreads,1);assert.equal(ort.env.wasm.proxy,false);
const firstPaths=ort.env.wasm.wasmPaths;await loader.configureORT(ort);assert.equal(ort.env.wasm.wasmPaths,firstPaths);
const beforeExternal=networkCalls;
await assert.rejects(context.fetch('https://example.com/model.onnx'),/blocked an external request/);
await assert.rejects(context.fetch('./missing-model.onnx'),/blocked an external request/);
assert.equal(networkCalls,beforeExternal,'blocked URLs never reach original fetch');
await assert.rejects(loader.loadAsset('onnx/missing.onnx'),/not embedded/);
assert.equal(nodes.size,0,'all decoded Base64 blocks are released');
const main=await readFile(resolve(ROOT,'main.mjs'),'utf8');
const adapted=adaptHarness(main);
assert.ok(!adapted.includes("fetch('./models/"));
assert.throws(()=>adaptHarness('changed harness'),/source anchor/);
const bundle=await bundleBrowser({source:adapted});assert.ok(bundle.code.length>100000);
const adapterBundle=await bundleBrowser({entry:resolve(ROOT,'paddle-session.mjs')});assert.ok(adapterBundle.code.includes('PDFPaddle'));
console.log('PASS: byte cache/session reload, JSON reuse, Blob assets, ORT asyncify paths, DOM release, external fetch blocking, source drift detection, harness and PDF Studio adapter bundles');
