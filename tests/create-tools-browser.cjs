const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const libraries=['sourceMappingURL=pdf-lib.min.js.map','pdfjs-dist/build/pdf"]','pdfjs-dist/build/pdf.worker'].map(marker=>scripts.find(s=>s.includes(marker)));
if(libraries.some(s=>!s))throw new Error('The current web build is missing a required PDF library; build index.html first.');
// Web builds load these assets lazily. Embed the same standalone IDs directly
// from the verified vendor files so this fixture still forbids all HTTP access.
const ocrFiles={'ocr-client':'tesseract.min.js','ocr-core':'tesseract-core-lstm.wasm.js','ocr-core-fast':'tesseract-core-relaxedsimd-lstm.wasm.js','ocr-worker':'worker.min.js','ocr-lang-kor':'lang/kor.traineddata.gz','ocr-lang-eng':'lang/eng.traineddata.gz'};
function embedded(directory,files){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor',directory,'manifest.json'),'utf8'));
 return Object.entries(files).map(([id,file])=>{
  const bytes=fs.readFileSync(path.join(root,'vendor',directory,file)),expected=manifest.files[file];
  if(!expected||bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new Error('Fixture asset integrity mismatch: '+directory+'/'+file);
  return `<script type="application/octet-stream" id="${id}">${bytes.toString('base64')}</script>`;
 }).join('\n');
}
const assets=embedded('ocr',ocrFiles)+'\n'+embedded('markup',{'ocr-search-font':'GlyphLessFont.ttf'});
const modules=['compression-plan','pro-engine','pro-document','pro-stamp','pro-ocr','pro-deskew','pro-pipeline'].map(n=>fs.readFileSync(path.join(root,'src',n+'.js'),'utf8'));
const testCode=fs.readFileSync(path.join(__dirname,'tools-browser.js'),'utf8');
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'fixtures/tools-check.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:;worker-src blob:;connect-src blob: data:;img-src data: blob:;style-src 'unsafe-inline'"><title>Stamp and OCR verification</title><style>body{font:14px system-ui;background:#eee;margin:24px}canvas{max-width:360px;border:1px solid #ccc}pre{white-space:pre-wrap}a{display:block;margin:10px}</style><h1>Stamp and OCR verification</h1><pre id="status">Starting</pre><pre id="result"></pre><div id="artifacts"></div>${assets}${[...libraries,...modules,testCode].map(s=>'<script>'+s+'</script>').join('')}`);
console.log('Generated tools-check.html; CSP blocks all HTTP requests including OCR assets.');
