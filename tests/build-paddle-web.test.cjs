const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const modulePromise=import(pathToFileURL(path.join(__dirname,'../scripts/build-paddle-web.mjs')).href);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const revision='test-pinned-revision';

function fixture(t,parts=[Buffer.from([1,2,3,4]),Buffer.from([5,6,7,8]),Buffer.from([9,10])]){
  const temporaryRoot=path.resolve(os.tmpdir()),directory=fs.mkdtempSync(path.join(temporaryRoot,'pdf-paddle-web-build-'));
  t.after(()=>{
    const absolute=path.resolve(directory);
    assert.equal(path.dirname(absolute),temporaryRoot,'recursive cleanup stays in the task-created temp directory');
    assert.ok(path.basename(absolute).startsWith('pdf-paddle-web-build-'));
    fs.rmSync(absolute,{recursive:true,force:true});
  });
  const bytes=Buffer.concat(parts),expected={path:'onnx/tiny.onnx',size:bytes.length,sha256:sha(bytes)};
  const chunks=parts.map((bytes,index)=>{const file='tiny.onnx.part-'+String(index).padStart(4,'0');fs.writeFileSync(path.join(directory,file),bytes);return {file,size:bytes.length,sha256:sha(bytes)};});
  const manifest={schemaVersion:1,model:'onnx-community/PaddleOCR-VL-1.5-ONNX',revision,chunkSize:4,totalSize:bytes.length,assets:[{...expected,chunks}]};
  const publish=()=>fs.writeFileSync(path.join(directory,'assets.json'),JSON.stringify(manifest));publish();
  return {directory,parts,expected,manifest,publish,options:{directory,revision,requiredAssets:[expected]}};
}

test('cached build manifest accepts ordered verified chunks including a shorter final part',async t=>{
  const {readyManifest}=await modulePromise,f=fixture(t);
  assert.deepEqual(await readyManifest(f.options),f.manifest);
});

test('swapping equal-sized valid chunks is rejected by the pinned whole-file hash',async t=>{
  const {readyManifest}=await modulePromise,f=fixture(t),chunks=f.manifest.assets[0].chunks;
  [chunks[0],chunks[1]]=[chunks[1],chunks[0]];f.publish();
  assert.equal(await readyManifest(f.options),null);
});

test('a corrupted part is rejected before the cached manifest is reused',async t=>{
  const {readyManifest}=await modulePromise,f=fixture(t);
  fs.writeFileSync(path.join(f.directory,f.manifest.assets[0].chunks[0].file),Buffer.from([11,2,3,4]));
  assert.equal(await readyManifest(f.options),null);
});

test('updating a corrupt part hash cannot bypass the trusted complete-file digest',async t=>{
  const {readyManifest}=await modulePromise,f=fixture(t),chunk=f.manifest.assets[0].chunks[0],corrupt=Buffer.from([11,2,3,4]);
  fs.writeFileSync(path.join(f.directory,chunk.file),corrupt);chunk.sha256=sha(corrupt);f.publish();
  assert.equal(await readyManifest(f.options),null);
});

test('manifest whole-file hash tampering is checked against requiredAssets',async t=>{
  const {readyManifest}=await modulePromise,f=fixture(t);f.manifest.assets[0].sha256='0'.repeat(64);f.publish();
  assert.equal(await readyManifest(f.options),null);
});

test('truncated, oversized, and missing final chunks make the cached build incomplete',async t=>{
  const {readyManifest}=await modulePromise;
  for(const action of ['truncated','oversized','missing']){
    const f=fixture(t),last=f.manifest.assets[0].chunks.at(-1),file=path.join(f.directory,last.file);
    if(action==='missing')fs.unlinkSync(file);else fs.writeFileSync(file,action==='truncated'?Buffer.from([9]):Buffer.from([9,10,11]));
    assert.equal(await readyManifest(f.options),null,action);
  }
});

test('chunk and aggregate sizes must agree with the manifest limits',async t=>{
  const {readyManifest}=await modulePromise;
  for(const mutate of [m=>{m.chunkSize=3;},m=>{m.chunkSize=0;},m=>{m.chunkSize=25*1024*1024+1;},m=>{m.totalSize++;},m=>{m.assets[0].chunks.at(-1).size++;}]){
    const f=fixture(t);mutate(f.manifest);f.publish();assert.equal(await readyManifest(f.options),null);
  }
});

test('wrong revision, unknown schema, and reused chunk paths are not reusable build manifests',async t=>{
  const {readyManifest}=await modulePromise;
  for(const mutate of [m=>{m.revision='other';},m=>{m.schemaVersion=2;},m=>{m.model='other/model';},m=>{m.assets[0].chunks[1]={...m.assets[0].chunks[0]};}]){
    const f=fixture(t);mutate(f.manifest);f.publish();assert.equal(await readyManifest(f.options),null);
  }
});
