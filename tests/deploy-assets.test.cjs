const test=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,writeFileSync,existsSync,readdirSync,unlinkSync,rmdirSync}=require('node:fs');
const {tmpdir}=require('node:os'),{join}=require('node:path'),{createHash}=require('node:crypto');
async function fixture(){
  const {finalizeDeploy}=await import('../scripts/finalize-deploy.mjs');
  const base=mkdtempSync(join(tmpdir(),'pdf-deploy-')),root=join(base,'.deploy');mkdirSync(root);
  const put=(file,data='fixture')=>{const full=join(root,file);mkdirSync(require('node:path').dirname(full),{recursive:true});writeFileSync(full,data);};
  put('index.html');put('_headers');put('privacy/current.zlib','verified');
  const entries=[{file:'index.html'},{file:'_headers'},{file:'privacy/current.zlib',bytes:8,sha256:createHash('sha256').update('verified').digest('hex')}];
  function clean(folder){for(const item of readdirSync(folder,{withFileTypes:true})){const path=join(folder,item.name);if(item.isDirectory())clean(path);else unlinkSync(path);}rmdirSync(folder);}
  return {root,base,put,entries,finalizeDeploy,cleanup:()=>clean(base)};
}
test('deployment finalization removes public QA and unrelated files but preserves current assets and external files',async()=>{
  const f=await fixture();try{
    f.put('__qa-local-ocr.html');f.put('ocr/paddle/old.js');f.put('privacy/old.zlib');f.put('nested/qa/document.pdf');
    const outside=join(f.base,'document.pdf');writeFileSync(outside,'outside');
    assert.deepEqual(f.finalizeDeploy(f.root,f.entries).sort(),['__qa-local-ocr.html','nested/qa/document.pdf','ocr/paddle/old.js','privacy/old.zlib']);
    assert.ok(existsSync(outside));for(const entry of f.entries)assert.ok(existsSync(join(f.root,entry.file)));
    assert.ok(!existsSync(join(f.root,'nested')));assert.deepEqual(f.finalizeDeploy(f.root,f.entries),[]);
  }finally{f.cleanup();}
});
test('valid historical runtime hashes remain available to editing sessions open across a deployment',async()=>{
  const f=await fixture();try{
    const body='previous production asset',sha=createHash('sha256').update(body).digest('hex');
    const retained=['privacy/'+sha+'.zlib','markup/'+sha+'-NanumGothic.ttf.zlib','ocr/tesseract/7.0.0/'+sha+'-worker.min.js',
      'ocr/ppocr-v5/adapter-'+sha.slice(0,16)+'.js','ocr/ppocr-v5/ort-wasm-simd-threaded-'+sha.slice(0,16)+'.wasm',
      'ocr/ppocr-v5/det-'+sha.slice(0,16)+'.onnx','ocr/ppocr-v5/dict-'+sha.slice(0,16)+'.json'];
    for(const file of retained)f.put(file,body);
    const corrupt='privacy/'+'0'.repeat(64)+'.zlib',qa='ocr/ppocr-v5/qa-'+sha.slice(0,16)+'.js';f.put(corrupt,body);f.put(qa,body);
    assert.deepEqual(f.finalizeDeploy(f.root,f.entries).sort(),[corrupt,qa].sort());
    for(const file of retained)assert.ok(existsSync(join(f.root,file)),file);
  }finally{f.cleanup();}
});
test('missing or corrupt required assets fail before any stale file is removed',async()=>{
  const f=await fixture();try{
    f.put('__qa-local-ocr.html');f.put('privacy/current.zlib','bad');
    assert.throws(()=>f.finalizeDeploy(f.root,f.entries),/integrity mismatch/);assert.ok(existsSync(join(f.root,'__qa-local-ocr.html')));
    f.put('privacy/current.zlib','verified');
    assert.throws(()=>f.finalizeDeploy(f.root,[...f.entries,{file:'missing.wasm'}]),/Missing deployment asset/);assert.ok(existsSync(join(f.root,'__qa-local-ocr.html')));
  }finally{f.cleanup();}
});
test('deployment pruning rejects an incorrect root and paths outside the generated directory',async()=>{
  const f=await fixture();try{
    f.put('__qa-local-ocr.html');
    assert.throws(()=>f.finalizeDeploy(f.base,f.entries),/Unsafe generated deployment directory/);
    for(const file of ['../document.pdf',join(f.base,'document.pdf')])assert.throws(()=>f.finalizeDeploy(f.root,[...f.entries,{file}]),/Unsafe generated asset path/);
    assert.throws(()=>f.finalizeDeploy(f.root,[]),/Missing deployment entry points/);assert.ok(existsSync(join(f.root,'__qa-local-ocr.html')));
  }finally{f.cleanup();}
});
