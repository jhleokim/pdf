import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8').trim();
const ocrManifest=JSON.parse(read('vendor/ocr/manifest.json'));
for(const [file,expected] of Object.entries(ocrManifest.files)){
  const bytes=readFileSync(resolve(root,'vendor/ocr',file));
  if(bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new Error('OCR asset integrity mismatch: '+file);
}
let html = read('index.html');
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
block('pro-styles', `<style>\n${read('src/pro-styles.css')}\n${read('src/pro-extra.css')}\n${read('src/pro-tools.css')}\n</style>`, '</head>');
block('mode-switch', '<div class="mode-switch" role="group" aria-label="작업 모드"><button id="modeBasic" aria-pressed="true">Basic</button><button id="modePro" aria-pressed="false">Pro</button></div><div class="pro-mobile-switch" id="proMobileSwitch" hidden><button id="proWorkspace">미리보기 크게</button><button id="proSettings">설정과 함께</button></div>', '<div class="tools">');
const panel=read('src/pro-panel.html');
const panelSplit=panel.indexOf('<details class="pro-section">',panel.indexOf('</details>'));
block('pro-panel',panel.slice(0,panelSplit)+read('src/pro-tools.html')+'\n'+panel.slice(panelSplit), '</main>');
block('stamp-dialog',read('src/stamp-dialog.html'),'</body>');
html=html.replace(/<!-- pro-dialog:start -->[\s\S]*?<!-- pro-dialog:end -->\s*/, '');
block('pro-dialog', read('src/pro-dialog.html'), '<!-- pro-panel:start -->');
const assets={'ocr-client':'tesseract.min.js','ocr-core':'tesseract-core-lstm.wasm.js','ocr-core-fast':'tesseract-core-relaxedsimd-lstm.wasm.js','ocr-worker':'worker.min.js','ocr-lang-kor':'lang/kor.traineddata.gz','ocr-lang-eng':'lang/eng.traineddata.gz'};
block('ocr-assets',Object.entries(assets).map(([id,file])=>`<script type="application/octet-stream" id="${id}">${readFileSync(resolve(root,'vendor/ocr',file)).toString('base64')}</script>`).join('\n'),'</body>');
block('ocr-licenses','<details hidden><summary>OCR licenses</summary><pre>'+['LICENSE-tesseract.js','LICENSE-tesseract.js-core','tesseract.min.js.LICENSE.txt','worker.min.js.LICENSE.txt','NOTICE.txt'].map(f=>read('vendor/ocr/'+f).replace(/&/g,'&amp;').replace(/</g,'&lt;')).join('\n')+'</pre></details>','</body>');
html=html.replace(/<!-- pro-runtime:start -->[\s\S]*?<!-- pro-runtime:end -->\s*/, '');
block('pro-runtime', ['pro-engine.js', 'pro-document.js', 'pro-stamp.js', 'pro-ocr.js', 'pro-gemini.js', 'pro-deskew.js', 'pro-pipeline.js', 'pro-result.js', 'pro-live-preview.js', 'pro-rail.js', 'pro-ui.js','pro-tools-ui.js'].map(f => `<script id="${f.replace('.js','')}">\n${read('src/' + f)}\n</script>`).join('\n'), '</body>');
html = html.replace('<title>PDF 페이지 편집기</title>', '<title>PDF Studio — Basic &amp; Pro</title>')
  .replace('<h1>PDF 페이지 편집기</h1>', '<h1>PDF Studio</h1>')
  .replace('OFFLINE · 로컬 처리', '내 기기에서 안전하게')
  .replace('<h2>여기에 파일을 놓으세요</h2>', '<h2>문서 작업, 가볍게 시작하세요</h2>')
  .replace('여러 개를 한 번에 올리면 하나의 문서로 합쳐서 편집합니다.<br>사진은 자동으로 페이지가 됩니다.', 'PDF나 사진을 이곳에 놓으세요.<br>합치고, 정리하고, 필요한 만큼 다듬을 수 있어요.')
  .replace('<div id="busy"><div class="box"><span class="spin"></span><span id="busyText">처리 중…</span></div></div>', '<div id="busy" role="status" aria-live="polite"><div class="box"><span class="spin"></span><span id="busyText">처리 중…</span><button class="btn" id="busyCancel" hidden>취소</button></div></div>');
// Both HTTP hosting and a double-clicked standalone use this exact artifact.
writeFileSync(resolve(root, 'index.html'), html + '\n', 'utf8');
console.log(`Built standalone index.html (${(Buffer.byteLength(html)/1048576).toFixed(2)} MiB); no external assets.`);
