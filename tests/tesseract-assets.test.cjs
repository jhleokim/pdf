const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const code=fs.readFileSync(path.join(__dirname,'../src/pro-tesseract-assets.js'),'utf8');
function setup(fetcher){const data=Uint8Array.from([10,20,30,40]),manifest={};for(const id of ['ocr-client','ocr-worker','ocr-core','ocr-core-fast','ocr-lang-eng','ocr-lang-kor'])manifest[id]={url:'/ocr/test/'+id,bytes:4,sha256:crypto.createHash('sha256').update(data).digest('hex')};
 const calls=[],ctx={crypto:crypto.webcrypto,Uint8Array,PDFTesseractManifest:manifest,fetch:async(url,options)=>{calls.push({url,options});return fetcher?fetcher(url,options,data):new Response(data);}};vm.runInNewContext(code,ctx);return {ctx,calls,data};}
test('Tesseract selects only needed assets, uses GET without documents, and reuses verified memory',async()=>{
 const {ctx,calls}=setup(),signal=new AbortController().signal,events=[];
 await ctx.PDFTesseractLoad('eng',true,signal,m=>events.push(m));assert.equal(calls.length,4);assert.ok(calls.some(c=>c.url.endsWith('ocr-core-fast')));assert.ok(!calls.some(c=>c.url.endsWith('ocr-lang-kor')));
 assert.ok(calls.every(c=>c.options.credentials==='omit'&&!c.options.body));assert.equal(events.at(-1).progress,1);
 await ctx.PDFTesseractLoad('kor+eng',true,signal);assert.equal(calls.length,5);assert.ok(ctx.PDFTesseractAssets.has('ocr-lang-kor'));
});
test('corrupt and oversized responses never enter the usable engine cache',async()=>{
 for(const data of [new Uint8Array([1,2,3,4]),new Uint8Array(5),new Uint8Array(2)]){const {ctx}=setup(()=>new Response(data));await assert.rejects(ctx.PDFTesseractLoad('eng',false,new AbortController().signal));assert.equal(ctx.PDFTesseractAssets.size,0);}
});
test('canceling during progress stops before further fetches and a fresh call can resume',async()=>{
 const {ctx,calls}=setup(),control=new AbortController();await assert.rejects(ctx.PDFTesseractLoad('eng',false,control.signal,m=>{if(m.progress>0)control.abort();}));assert.equal(calls.length,1);
 await ctx.PDFTesseractLoad('eng',false,new AbortController().signal);assert.equal(calls.length,4);
});
test('the OCR session uses the downloaded SIMD core when no embedded core DOM exists',async()=>{
 const {ctx}=setup();Object.assign(ctx,{document:{getElementById:()=>null},WebAssembly:{validate:()=>true},Blob,URL,setTimeout,clearTimeout,DOMException,
 Tesseract:{createWorker:async()=>({setParameters:async()=>{},terminate:async()=>{}})}});
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/pro-ocr.js'),'utf8'),ctx);
 const session=await ctx.PDFOCR.session('eng',new AbortController().signal,()=>{});assert.equal(session.accelerated,true);await session.close();
});
