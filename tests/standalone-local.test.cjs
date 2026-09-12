const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),web=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=(html,id)=>html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))?.[1];
const normalized=text=>text.replace(/\r\n/g,'\n');

test('standalone embeds both local OCR engines and excludes cloud entry points',async()=>{
  const {buildHTML}=await import('../scripts/build.mjs'),offline=buildHTML({standalone:true});
  for(const id of ['visionTools','visionDialog','visionUnlockDialog','pro-gemini','pro-vision-unlock'])assert.match(web,new RegExp(`id="${id}"`),id+' remains web-only');
  assert.doesNotMatch(offline,/id="(?:gemini\w*|pro-gemini(?:-ui)?)"|geminiClicks|\/api\/ocr\/gemini|generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(offline,/<script\b[^>]*\bsrc\s*=/i);
  assert.ok(script(offline,'paddle-bootstrap')?.includes('const embedded='),'offline includes its local Paddle assets');
  assert.doesNotMatch(offline,/\/ocr\/paddle\/runtime-[a-f0-9]+\.mjs/);
  assert.doesNotMatch(offline,/id="pro-tesseract-assets"|value="paddle-vl15"/);
  assert.doesNotMatch(offline,/id="(?:vision\w*|pro-vision(?:-ui)?)"|value="vision"|\/api\/ocr\/vision|vision\.googleapis\.com/);
  assert.doesNotMatch(web,/<option value="vision">/);
  assert.doesNotMatch(web,/id="geminiTools"|id="geminiDialog"|id="pro-gemini-ui"/);
  assert.doesNotMatch(offline,/visionUnlock|rltnfchlrh/);
  assert.match(web,/value="tesseract" selected/);
  assert.match(web,/value="paddle-v5"/);assert.match(offline,/value="paddle-v5"/);assert.doesNotMatch(web,/value="paddle-vl15"/);
  const assets={'ocr-client':'tesseract.min.js','ocr-core':'tesseract-core-lstm.wasm.js','ocr-core-fast':'tesseract-core-relaxedsimd-lstm.wasm.js','ocr-worker':'worker.min.js','ocr-lang-kor':'lang/kor.traineddata.gz','ocr-lang-eng':'lang/eng.traineddata.gz'};
  for(const [id,file] of Object.entries(assets)){
    const embedded=script(offline,id);assert.ok(embedded,id+' is embedded offline');
    assert.deepEqual(Buffer.from(embedded.trim(),'base64'),fs.readFileSync(path.join(root,'vendor/ocr',file)),id+' matches the local vendor asset');
    assert.equal(script(web,id),undefined,id+' is excluded from the Paddle web page');
  }
  for(const id of ['pro-ocr','pro-stamp','pro-tools-ui','editor-code','markup-text']){
    assert.ok(script(offline,id),id);assert.equal(normalized(script(offline,id)),normalized(script(web,id)),id+' common source remains identical');
  }
  const defaults=script(offline,'pro-tools-ui').match(/function ocrDefaultProvider\(\)\{[^}]*\}/)?.[0];
  assert.ok(defaults,'the common UI exposes the build-selected default provider');
  const selected=value=>()=>({value});
  assert.equal(vm.runInNewContext(defaults+';ocrDefaultProvider()',{$:selected('tesseract')}),'tesseract');
  assert.equal(vm.runInNewContext(defaults+';ocrDefaultProvider()',{$:selected('paddle-v5')}),'tesseract','standalone cannot select unavailable Paddle');
  assert.equal(vm.runInNewContext(defaults+';ocrDefaultProvider()',{$:selected('tesseract'),PDFPaddleLoad:()=>{}}),'tesseract');
  assert.equal(vm.runInNewContext(defaults+';ocrDefaultProvider()',{$:selected('paddle-v5'),PDFPaddleLoad:()=>{}}),'paddle-v5');
  assert.equal(vm.runInNewContext(defaults+';ocrDefaultProvider()',{$:selected('vision'),PDFVision:{}}),'vision');
  assert.equal(vm.runInNewContext(defaults+';ocrDefaultProvider()',{$:selected('vision')}),'tesseract');
  const bootstrap=script(web,'paddle-bootstrap'),manifest=JSON.parse(fs.readFileSync(path.join(root,'.deploy/ocr/ppocr-v5/manifest.json'),'utf8'));
  assert.ok(bootstrap,'web includes its lazy runtime bootstrap');
  const context={};vm.runInNewContext(bootstrap,context);assert.equal(context.PDFPaddleReady,undefined,'no Paddle load before choosing it');assert.equal(typeof context.PDFPaddleLoad,'function');assert.ok(context.PDFTesseractManifest['ocr-client']);
  assert.match(manifest.runtimeURL,/^\/ocr\/ppocr-v5\/adapter-[a-f0-9]{16}\.js$/);
  assert.ok(bootstrap.includes(JSON.stringify(manifest.runtimeURL)),'web loads versioned lightweight runtime');
  assert.equal(manifest.modelBytes,18245305);
  const offlineContext={};vm.runInNewContext(script(offline,'paddle-bootstrap'),offlineContext);assert.equal(typeof offlineContext.PDFPaddleLoad,'function');assert.equal(offlineContext.PDFPaddleV5Assets,undefined,'standalone defers decoding until chosen');
  for(const html of [web,offline])assert.match(html,/id="ocrCorrectionDialog"/);
  assert.ok(web.indexOf('id="paddle-bootstrap"')<web.indexOf('id="pro-tools-ui"'),'provider is selected before the common UI initializes');
  assert.equal(normalized(buildHTML()),normalized(web),'hosted build remains reproducible');
  assert.equal(normalized(buildHTML({standalone:true})),normalized(offline),'offline build remains reproducible independently');
});
