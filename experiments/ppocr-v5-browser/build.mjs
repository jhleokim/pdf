import fs from 'node:fs';
const root=new URL('../../',import.meta.url),out=new URL('work/ppocr-v5-trial/',root);
fs.mkdirSync(out,{recursive:true});
for(const [src,dst] of [
 ['node_modules/onnxruntime-web/dist/ort.wasm.min.js','ort.js'],
 ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.mjs'],
 ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm','ort-wasm-simd-threaded.wasm'],
 ['experiments/ppocr-v5-browser/node_modules/@techstark/opencv-js/dist/opencv.js','opencv.js'],
 ['work/ppocr-v5-models/det.onnx','det.onnx'],['work/ppocr-v5-models/rec.onnx','rec.onnx'],['work/ppocr-v5-models/dict.json','dict.json'],
 ['experiments/ppocr-v5-browser/engine.js','engine.js'],['experiments/ppocr-v5-browser/worker.js','worker.js'],['experiments/ppocr-v5-browser/ui.js','ui.js'],['src/ocr-correction.js','ocr-correction.js']])fs.copyFileSync(new URL(src,root),new URL(dst,out));
const shell=fs.readFileSync(new URL('experiments/ppocr-v5-browser/index.html',root),'utf8')
 .replace('<!-- correction-style -->','<style>'+fs.readFileSync(new URL('src/ocr-correction.css',root),'utf8')+'</style>')
 .replace('<!-- correction-dialog -->',fs.readFileSync(new URL('src/ocr-correction.html',root),'utf8'));
fs.writeFileSync(new URL('index.html',out),shell);
const html=fs.readFileSync(new URL('index.html',root),'utf8');
const pdfScripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.length>100000&&s.includes('Copyright 2023 Mozilla Foundation'));
if(pdfScripts.length!==2)throw Error('Bundled PDF.js scripts missing');
fs.writeFileSync(new URL('pdfjs.js',out),pdfScripts[0]);fs.writeFileSync(new URL('pdf.worker.js',out),pdfScripts[1]);
console.log('Trial built in '+out.pathname);
