const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const modulePromise=import('../scripts/prepare-paddle-assets.mjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function fixture(t,bytes){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'paddle-assets-test-'));
  const sourceFile=path.join(root,'source'),outputDirectory=path.join(root,'out');
  fs.writeFileSync(sourceFile,bytes);fs.mkdirSync(outputDirectory);
  t.after(()=>{
    const resolved=path.resolve(root),tempRoot=path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(tempRoot+path.sep)&&path.basename(resolved).startsWith('paddle-assets-test-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  return {sourceFile,outputDirectory,asset:{path:'onnx/test.onnx',size:bytes.length,sha256:sha(bytes)},chunkSize:4};
}

test('asset chunks reconstruct the exact original, including the partial final chunk',async t=>{
  const {splitVerifiedAsset}=await modulePromise,bytes=Buffer.from('abcdefghijk'),options=fixture(t,bytes);
  const first=await splitVerifiedAsset(options);
  assert.deepEqual(first.chunks.map(chunk=>chunk.size),[4,4,3]);
  const parts=first.chunks.map(chunk=>{
    const content=fs.readFileSync(path.join(options.outputDirectory,chunk.file));
    assert.equal(content.length,chunk.size);assert.equal(sha(content),chunk.sha256);return content;
  });
  assert.deepEqual(Buffer.concat(parts),bytes);
  const times=first.chunks.map(chunk=>fs.statSync(path.join(options.outputDirectory,chunk.file)).mtimeMs);
  assert.deepEqual(await splitVerifiedAsset(options),first);
  assert.deepEqual(first.chunks.map(chunk=>fs.statSync(path.join(options.outputDirectory,chunk.file)).mtimeMs),times);
});

test('corrupt source is rejected before outputs are written',async t=>{
  const {splitVerifiedAsset}=await modulePromise,options=fixture(t,Buffer.from('abcdefghijk'));
  fs.writeFileSync(options.sourceFile,Buffer.from('abcdefghijX'));
  await assert.rejects(splitVerifiedAsset(options),/SHA256 mismatch/);
  assert.deepEqual(fs.readdirSync(options.outputDirectory),[]);
});

test('corrupt prepared chunks are repaired and cannot silently be reused',async t=>{
  const {splitVerifiedAsset}=await modulePromise,options=fixture(t,Buffer.from('abcdefghijk'));
  const first=await splitVerifiedAsset(options),file=path.join(options.outputDirectory,first.chunks[0].file);
  fs.writeFileSync(file,'xxxx');
  assert.deepEqual(await splitVerifiedAsset(options),first);
  assert.equal(fs.readFileSync(file,'utf8'),'abcd');
  assert.ok(fs.readdirSync(path.dirname(file)).every(name=>!name.includes('.tmp-')));
});

test('path traversal and chunks above the deployment bound are rejected',async t=>{
  const {splitVerifiedAsset,CHUNK_SIZE}=await modulePromise,options=fixture(t,Buffer.from('abcdefghijk'));
  await assert.rejects(splitVerifiedAsset({...options,asset:{...options.asset,path:'../outside'}}),/Unsafe asset path/);
  await assert.rejects(splitVerifiedAsset({...options,chunkSize:CHUNK_SIZE+1}),/20 MiB/);
  assert.deepEqual(fs.readdirSync(options.outputDirectory),[]);
});

test('source manifest must match the pinned revision and every model digest',async()=>{
  const {validateSourceManifest}=await modulePromise;
  const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../vendor/paddle/model-source.json'),'utf8'));
  assert.doesNotThrow(()=>validateSourceManifest(source));
  assert.throws(()=>validateSourceManifest({...source,sha:'main'}),/revision/);
  const changed=structuredClone(source);
  changed.siblings.find(item=>item.rfilename==='onnx/decoder_q4.onnx').lfs.sha256='0'.repeat(64);
  assert.throws(()=>validateSourceManifest(changed),/manifest mismatch/);
});
