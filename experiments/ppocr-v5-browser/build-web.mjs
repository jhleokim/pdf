import fs from 'node:fs';
import {createHash} from 'node:crypto';
import './build.mjs';

const root=new URL('../../',import.meta.url);
const trial=new URL('work/ppocr-v5-trial/',root);
const out=new URL('dist/ppocr-v5-web/',root);
// Never deploy the working directory: it also contains private test documents/results.
const assets=['index.html','ui.js','ocr-correction.js','worker.js','engine.js','ort.js','opencv.js','pdfjs.js','pdf.worker.js','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','det.onnx','rec.onnx','dict.json'];
const allowed=new Set([...assets,'licenses.txt','_headers']);
fs.mkdirSync(out,{recursive:true});
for(const name of fs.readdirSync(out))if(!allowed.has(name))throw Error('Unexpected deployment file: '+name);
const manifest=JSON.parse(fs.readFileSync(new URL('models.json',import.meta.url),'utf8'));
for(const item of manifest.filter(x=>x.file.endsWith('.onnx'))){
 const bytes=fs.readFileSync(new URL(item.file,trial));
 if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Model integrity mismatch: '+item.file);
}
for(const name of assets)fs.copyFileSync(new URL(name,trial),new URL(name,out));
const licenses=['experiments/ppocr-v5-browser/LICENSE-PaddleOCR','experiments/ppocr-v5-browser/LICENSE-OpenCV','vendor/paddle/licenses/onnxruntime-1.29.0-LICENSE.txt','vendor/paddle/licenses/onnxruntime-1.29.0-ThirdPartyNotices.txt'];
fs.writeFileSync(new URL('licenses.txt',out),licenses.map(name=>fs.readFileSync(new URL(name,root),'utf8')).join('\n\n'));
let html=fs.readFileSync(new URL('index.html',out),'utf8');
html=html.replace('<!-- license-link -->',' · <a href="licenses.txt">오픈소스 라이선스</a>');
fs.writeFileSync(new URL('index.html',out),html);
fs.writeFileSync(new URL('_headers',out),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow
  Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data:; img-src 'self' blob: data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
`);
console.log('Web deployment assets: '+fs.readdirSync(out).join(', '));
