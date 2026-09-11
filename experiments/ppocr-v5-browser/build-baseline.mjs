import fs from 'node:fs';
const root=new URL('../../',import.meta.url),trial=new URL('work/ppocr-v5-trial/',root);
let html=fs.readFileSync(new URL('index.html',trial),'utf8').replaceAll('PP-OCRv5 한국어','Tesseract 대조 시험');
const assets={'ocr-client':'tesseract.min.js','ocr-core':'tesseract-core-lstm.wasm.js','ocr-core-fast':'tesseract-core-relaxedsimd-lstm.wasm.js','ocr-worker':'worker.min.js','ocr-lang-kor':'lang/kor.traineddata.gz','ocr-lang-eng':'lang/eng.traineddata.gz'};
let scripts=Object.entries(assets).map(([id,file])=>`<script type="application/octet-stream" id="${id}">${fs.readFileSync(new URL('vendor/ocr/'+file,root)).toString('base64')}</script>`).join('\n');
scripts+='<script>'+fs.readFileSync(new URL('src/pro-ocr.js',root),'utf8')+'</script>';
scripts+=`<script>async function createTesseractBaseline({signal,onProgress}){const session=await PDFOCR.session('kor+eng',signal,m=>onProgress(m.status,m.progress),'auto');return {async recognize(canvas){const start=performance.now(),r=await session.recognize(canvas);const words=r.words.map(w=>({...w,confidence:w.confidence/100,quad:[[w.box[0]*canvas.width,w.box[1]*canvas.height],[w.box[2]*canvas.width,w.box[1]*canvas.height],[w.box[2]*canvas.width,w.box[3]*canvas.height],[w.box[0]*canvas.width,w.box[3]*canvas.height]]}));return {...r,words,detected:words.length,elapsedMs:performance.now()-start,backend:'Tesseract 7 auto PSM3+6',width:canvas.width,height:canvas.height};},close:session.close};}</script>`;
const ui=fs.readFileSync(new URL('ui.js',trial),'utf8').replace('engine=await createPPV5','engine=await createTesseractBaseline');
html=html.replace('<script src="ui.js"></script>',scripts+'<script>'+ui+'</script>');fs.writeFileSync(new URL('baseline.html',trial),html);
