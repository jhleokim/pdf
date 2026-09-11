import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { buildPaddleWeb } from './build-paddle-web.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8').trim();
const ocrManifest=JSON.parse(read('vendor/ocr/manifest.json'));
for(const [file,expected] of Object.entries(ocrManifest.files)){
  const bytes=readFileSync(resolve(root,'vendor/ocr',file));
  if(bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new Error('OCR asset integrity mismatch: '+file);
}
const tesseractFiles={'ocr-client':'tesseract.min.js','ocr-core':'tesseract-core-lstm.wasm.js','ocr-core-fast':'tesseract-core-relaxedsimd-lstm.wasm.js','ocr-worker':'worker.min.js','ocr-lang-kor':'lang/kor.traineddata.gz','ocr-lang-eng':'lang/eng.traineddata.gz'};
export const tesseractWebAssets=Object.fromEntries(Object.entries(tesseractFiles).map(([id,file])=>[id,{...ocrManifest.files[file],file,url:'/ocr/tesseract/7.0.0/'+ocrManifest.files[file].sha256+'-'+file.split('/').pop()}]));
export function buildHTML({standalone=false}={}){
let html = read('index.html');
html=html.replace(/<!-- paddle-bootstrap:start -->[\s\S]*?<!-- paddle-bootstrap:end -->\s*/,'');
function block(name, content, before) {
  const start = `<!-- ${name}:start -->`, end = `<!-- ${name}:end -->`;
  const chunk = `${start}\n${content}\n${end}`;
  if (html.includes(start)) {
    const a = html.indexOf(start), b = html.indexOf(end, a);
    if (b < a) throw new Error(`Broken block: ${name}`);
    html = html.slice(0, a) + chunk + html.slice(b + end.length);
  } else {
    if (!html.includes(before)) throw new Error(`Missing insertion point: ${before}`);
    html = html.replace(before, chunk + '\n' + before);
  }
}
const version=read('VERSION');
if(!/^\d+\.\d+(?:\.\d+)?$/.test(version))throw new Error('Invalid VERSION');
block('app-version', `<span class="app-version" aria-label="버전 ${version}">v${version}</span>`, '</body>');
const appStart = '<script id="editor-code">';
const a = html.indexOf(appStart), b = html.indexOf('</script>', a);
if (a < 0 || b < 0) throw new Error('Missing editor-code block');
html = html.slice(0, a + appStart.length) + '\n' + read('src/editor.js') + '\n' + html.slice(b);
block('pro-styles', `<style>\n${read('src/pro-styles.css')}\n${read('src/pro-extra.css')}\n${read('src/pro-tools.css')}\n${read('src/pro-workspace.css')}\n${read('src/markup.css')}\n${read('src/text-save.css')}\n</style>`, '</head>');
const toolbarStart=html.indexOf('<div class="anno-bar" id="annoBar"'),toolbarEnd=html.indexOf('<div class="pv-body"',toolbarStart);
if(toolbarStart<0||toolbarEnd<0)throw new Error('Missing markup toolbar');
html=html.slice(0,toolbarStart)+read('src/markup-toolbar.html')+'\n'+html.slice(toolbarEnd);
block('markup-icons',read('src/markup-icons.html'),'</body>');
block('text-editor',read('src/text-editor.html'),'</body>');
block('save-dialog',read('src/save-dialog.html'),'</body>');
block('print-dialog',read('src/print-dialog.html'),'</body>');
block('print-button','<button class="btn icon" id="btnPrint" title="인쇄 (Ctrl+P)" aria-label="현재 문서 인쇄" disabled><svg class="ic" aria-hidden="true"><use href="#i-printer"/></svg></button>','<button class="btn primary" id="btnSave"');
block('mobile-print-button','<button class="ab-btn" id="mbPrint" title="인쇄" aria-label="현재 문서 인쇄" disabled><svg class="ic" aria-hidden="true"><use href="#i-printer"/></svg></button>','<button class="ab-btn solid" id="mbSave"');
const markupManifest=JSON.parse(read('vendor/markup/manifest.json'));
for(const [file,expected] of Object.entries(markupManifest.files)){
 const data=readFileSync(resolve(root,'vendor/markup',file));if(data.length!==expected.bytes||createHash('sha256').update(data).digest('hex')!==expected.sha256)throw new Error('Markup asset integrity mismatch: '+file);
}
block('markup-assets',Object.entries({'markup-fontkit':'fontkit.umd.min.js','markup-font-gothic':'NanumGothic.ttf.zlib','markup-font-myeongjo':'NanumMyeongjo.ttf.zlib'}).map(([id,file])=>`<script type="application/octet-stream" id="${id}">${readFileSync(resolve(root,'vendor/markup',file)).toString('base64')}</script>`).join('\n'),'</body>');
block('markup-licenses','<details hidden><summary>Markup font licenses</summary><pre>'+['LICENSE-fontkit','NanumGothic-OFL.txt','NanumMyeongjo-OFL.txt'].map(f=>read('vendor/markup/'+f).replace(/&/g,'&amp;').replace(/</g,'&lt;')).join('\n')+'</pre></details>','</body>');
html=html.replace(/<!-- markup-runtime:start -->[\s\S]*?<!-- markup-runtime:end -->\s*/,'');
block('mode-switch', '<div class="mode-switch" role="group" aria-label="작업 모드"><button id="modeBasic" aria-pressed="true">Basic</button><button id="modePro" aria-pressed="false">Pro</button></div><div class="pro-mobile-switch" id="proMobileSwitch" hidden><button id="proWorkspace">미리보기 크게</button><button id="proSettings">설정과 함께</button></div>', '<div class="tools">');
const panel=read('src/pro-panel.html');
const toolPanel=read('src/pro-tools.html').replace('<!-- cloud-ocr-tools -->',standalone?'':read('src/pro-gemini-tools.html')).replace('<!-- cloud-ocr-dialog -->',standalone?'':read('src/pro-gemini-dialog.html')).replace('<!-- paddle-model-option -->',standalone?'':'<option value="paddle-vl15">PaddleOCR-VL-1.5 · WebGPU</option>');
const panelSplit=panel.indexOf('<details class="pro-section">',panel.indexOf('</details>'));
block('pro-panel',panel.slice(0,panelSplit)+toolPanel+'\n'+panel.slice(panelSplit), '</main>');
block('stamp-dialog',read('src/stamp-dialog.html'),'</body>');
html=html.replace(/<!-- pro-dialog:start -->[\s\S]*?<!-- pro-dialog:end -->\s*/, '');
block('pro-dialog', read('src/pro-dialog.html'), '<!-- pro-panel:start -->');
const assets={'ocr-client':'tesseract.min.js','ocr-core':'tesseract-core-lstm.wasm.js','ocr-core-fast':'tesseract-core-relaxedsimd-lstm.wasm.js','ocr-worker':'worker.min.js','ocr-lang-kor':'lang/kor.traineddata.gz','ocr-lang-eng':'lang/eng.traineddata.gz'};
if(standalone)block('ocr-assets',Object.entries(assets).map(([id,file])=>`<script type="application/octet-stream" id="${id}">${readFileSync(resolve(root,'vendor/ocr',file)).toString('base64')}</script>`).join('\n'),'</body>');
else html=html.replace(/<!-- ocr-assets:start -->[\s\S]*?<!-- ocr-assets:end -->\s*/,'');
block('ocr-licenses','<details hidden><summary>OCR licenses</summary><pre>'+['LICENSE-tesseract.js','LICENSE-tesseract.js-core','tesseract.min.js.LICENSE.txt','worker.min.js.LICENSE.txt','NOTICE.txt'].map(f=>read('vendor/ocr/'+f).replace(/&/g,'&amp;').replace(/</g,'&lt;')).join('\n')+'</pre></details>','</body>');
html=html.replace(/<!-- pro-runtime:start -->[\s\S]*?<!-- pro-runtime:end -->\s*/, '');
block('pro-runtime', ['work-progress.js','pro-tesseract-assets.js','pro-engine.js', 'pro-document.js', 'pro-stamp.js', 'pro-ocr.js', 'pro-gemini.js', 'pro-deskew.js', 'pro-pipeline.js', 'pro-result.js', 'pro-live-preview.js', 'pro-rail.js', 'pro-ui.js','pro-tools-ui.js','pro-gemini-ui.js'].filter(f=>!standalone||!f.startsWith('pro-gemini')&&f!=='pro-tesseract-assets.js').map(f => `<script id="${f.replace('.js','')}">\n${read('src/' + f)}\n</script>`).join('\n'), '</body>');
if(!standalone){
  const paddle=JSON.parse(read('vendor/paddle/web-build.json'));
  if(!/^\/ocr\/paddle\/runtime-[a-f0-9]{16}\.mjs$/.test(paddle.runtimeURL))throw Error('Invalid Paddle runtime path');
  block('paddle-bootstrap',`<script id="paddle-bootstrap">globalThis.PDFTesseractManifest=${JSON.stringify(tesseractWebAssets)};globalThis.PDFPaddleLoad=()=>globalThis.PDFPaddleReady??=(import(${JSON.stringify(paddle.runtimeURL)}).catch(error=>{globalThis.PDFPaddleReady=null;throw error;}));</script>`,'<!-- pro-runtime:start -->');
  html=html.replace('네트워크 0건','기기에서 인식');
}
if(!html.includes('<!-- work-progress-ui:start -->'))html=html.replace(/<div id="busy"[^>]*><div class="box">[\s\S]*?<\/div><\/div>/,'');
block('work-progress-ui','<div id="busy" role="status" aria-live="polite"><div class="box"><span class="spin"></span><span id="busyText">처리 중…</span><button class="btn" id="busyCancel" hidden>취소</button><div class="busy-metrics" id="busyMetrics" aria-live="off"><div class="busy-stat"><strong id="busyPercent">전체 작업 0%</strong><span id="busyElapsed">0분 00초 경과</span></div><progress id="busyProgress" max="100" value="0" aria-label="작업 진행률"></progress><div id="busyRemaining">남은 시간 계산 중</div></div></div></div>','</body>');
block('markup-runtime',['markup-text.js','markup-editor.js','text-editor-ui.js','markup-highlight.js','save-ui.js','edit-history.js','print-ui.js'].map(f=>`<script id="${f.replace('.js','')}">\n${read('src/'+f)}\n</script>`).join('\n'),'</body>');
html = html.replace('<title>PDF 페이지 편집기</title>', '<title>PDF Studio — Basic &amp; Pro</title>')
  .replace('<h1>PDF 페이지 편집기</h1>', '<h1>PDF Studio</h1>')
  .replace('OFFLINE · 로컬 처리', '내 기기에서 안전하게')
  .replace('<h2>여기에 파일을 놓으세요</h2>', '<h2>문서 작업, 가볍게 시작하세요</h2>')
  .replace('여러 개를 한 번에 올리면 하나의 문서로 합쳐서 편집합니다.<br>사진은 자동으로 페이지가 됩니다.', 'PDF나 사진을 이곳에 놓으세요.<br>합치고, 정리하고, 필요한 만큼 다듬을 수 있어요.')
  .replace('<div id="busy"><div class="box"><span class="spin"></span><span id="busyText">처리 중…</span></div></div>', '<div id="busy" role="status" aria-live="polite"><div class="box"><span class="spin"></span><span id="busyText">처리 중…</span><button class="btn" id="busyCancel" hidden>취소</button></div></div>');
return html+'\n';
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await buildPaddleWeb();
 const html=buildHTML();writeFileSync(resolve(root,'index.html'),html,'utf8');
 console.log('Built web index.html ('+(Buffer.byteLength(html)/1048576).toFixed(2)+' MiB); model loads on first OCR use.');
}
