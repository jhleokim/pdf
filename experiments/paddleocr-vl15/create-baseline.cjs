// Copy the current complete app bundle and append a manual real-engine baseline.
// No app source changes, mock OCR, model downloads, or external image requests.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const out = __dirname;
const root = path.resolve(out, '../..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const source = fs.readFileSync(path.join(root, 'index.html'));
let html = source.toString('utf8');
const truth = JSON.parse(fs.readFileSync(path.join(out, 'fixtures/truth.json'), 'utf8'));
const required = ['ocr-client', 'ocr-core', 'ocr-core-fast', 'ocr-worker', 'ocr-lang-kor', 'ocr-lang-eng', 'pro-ocr'];
for (const id of required) if (!html.includes(`id="${id}"`)) throw Error(`Current app is missing ${id}`);
const fixtures = truth.documents.map(document => {
  const bytes = fs.readFileSync(path.join(out, 'fixtures', document.image));
  if (sha(bytes) !== document.sha256) throw Error('Fixture differs from truth manifest: ' + document.id);
  if (document.width !== 1400 || document.height !== 1800) throw Error('Unexpected source dimensions');
  return {id: document.id, image: document.image, width: document.width, height: document.height,
    sha256: document.sha256, bytes: bytes.length, data: 'data:image/png;base64,' + bytes.toString('base64')};
});
const csp = "connect-src 'self' blob: data:; img-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'";
const head = `<meta http-equiv="Content-Security-Policy" content="${csp}"><script>window.__baselineCspViolations=[];addEventListener('securitypolicyviolation',e=>window.__baselineCspViolations.push({directive:e.effectiveDirective,blockedURI:String(e.blockedURI).slice(0,180)}));</script>`;
if (!/<head\b[^>]*>/i.test(html) || !html.includes('</body>')) throw Error('App document shape changed');
html = html.replace(/<head\b[^>]*>/i, match => match + head)
  .replace(/<title>[\s\S]*?<\/title>/i, '<title>Tesseract 7 actual engine baseline · synthetic images</title>');
const harness = `
<style>
html,body{height:auto!important;min-height:100vh!important;overflow:auto!important;background:#f4f5f5!important}
body{display:block!important;margin:0!important;padding:0!important}
body>*:not(#baselineHarness){display:none!important}
#baselineHarness{display:block!important;box-sizing:border-box;max-width:1060px;margin:24px auto;padding:24px;background:#fff;color:#202124;border:1px solid #d9dcde;border-radius:6px;font:14px/1.6 system-ui,sans-serif}
#baselineHarness h1{font-size:21px;margin:0 0 12px}#baselineHarness p{margin:8px 0 14px}
#baselineStart{appearance:none;padding:10px 18px;border:1px solid #007e75;border-radius:5px;background:#008578;color:white;font:600 14px system-ui;cursor:pointer}
#baselineStart:disabled{opacity:.55;cursor:wait}#baselineStart:focus-visible{outline:3px solid #92cec8;outline-offset:3px}
#baselineStatus{font-weight:600;white-space:pre-wrap}#baselineReport{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f7f7;border:1px solid #e0e3e4;padding:14px;max-height:65vh;overflow:auto;user-select:text}
</style>
<section id="baselineHarness" aria-labelledby="baselineTitle">
<h1 id="baselineTitle">Tesseract 7 실제 엔진 비교</h1>
<p>합성 이미지 3장을 원본 1400 × 1800 크기로 인식합니다. 현재 앱에 내장된 한글·영어 엔진과 자동 문서 구성을 그대로 사용하며, 결과를 보정하지 않습니다.</p>
<button id="baselineStart" type="button">실제 인식 시작</button>
<p id="baselineStatus" role="status" aria-live="polite">시작 버튼을 누르면 엔진을 준비합니다.</p>
<pre id="baselineReport" aria-label="실제 인식 결과 JSON"></pre>
</section>
<script>
(() => {
  'use strict';
  const fixtures = ${JSON.stringify(fixtures)};
  const sourceIndexSha256 = ${JSON.stringify(sha(source))};
  const button = document.getElementById('baselineStart');
  const status = document.getElementById('baselineStatus');
  const output = document.getElementById('baselineReport');
  let running = false, controller = null, currentEngine = null;
  const round = value => Math.round(value * 10) / 10;
  const resourceAudit = () => performance.getEntriesByType('resource')
    .filter(entry => /^https?:/.test(entry.name) && new URL(entry.name).origin !== location.origin)
    .map(entry => ({url:entry.name, initiator:entry.initiatorType}));
  let report = {status:'idle', engine:'tesseract-7-auto', mocked:false, synthetic_only:true, source_index_sha256:sourceIndexSha256, results:[]};
  const publish = () => {output.textContent = JSON.stringify(report, null, 2);output.dataset.status = report.status;};
  publish();
  button.addEventListener('click', async () => {
    if(running) return;
    running = true; button.disabled = true;
    controller = new AbortController();
    const signal = controller.signal, started = performance.now();
    let active = 'engine', previousPercent = -1;
    report = {status:'running', engine:'tesseract-7-auto', mocked:false, synthetic_only:true,
      source_index_sha256:sourceIndexSha256, started_at:new Date().toISOString(),
      runtime:{user_agent:navigator.userAgent, language_argument:'kor', loaded_languages:['kor','eng'], layout:'auto', resize:'none', image_width:1400, image_height:1800},
      session:{shared_across_images:true}, progress:[], results:[]};
    publish();
    try {
      if(!globalThis.PDFOCR || typeof PDFOCR.session !== 'function') throw Error('Bundled PDFOCR.session is unavailable');
      status.textContent = '실제 Tesseract 엔진 준비 중…';
      const prepareStarted = performance.now();
      currentEngine = await PDFOCR.session('kor', signal, event => {
        const percent = Math.round((event.progress || 0) * 100);
        status.textContent = active === 'engine' ? '실제 Tesseract 엔진 준비 중…' : active + ' · 실제 인식 중 ' + percent + '%';
        if(percent !== previousPercent) {
          report.progress.push({id:active, status:event.status, percent, since_start_ms:round(performance.now()-started)});
          previousPercent = percent;
        }
      }, 'auto');
      report.session.model_load_ms = round(performance.now() - prepareStarted);
      report.session.accelerated = !!currentEngine.accelerated;
      publish();
      for(let index=0; index<fixtures.length; index++) {
        signal.throwIfAborted();
        const fixture = fixtures[index]; active = fixture.id; previousPercent = -1;
        status.textContent = (index+1) + ' / ' + fixtures.length + ' · ' + fixture.id + ' 원본 이미지 준비';
        const loadStarted = performance.now();
        const image = new Image(); image.src = fixture.data; await image.decode();
        if(image.naturalWidth!==1400 || image.naturalHeight!==1800) throw Error('Source dimensions changed: '+fixture.id);
        const canvas = document.createElement('canvas'); canvas.width=1400;canvas.height=1800;
        const context = canvas.getContext('2d');
        if(!context) throw Error('2D canvas unavailable');
        context.drawImage(image, 0, 0); // Natural dimensions: no crop, resize, or preprocessing.
        const fixtureLoadMs = round(performance.now()-loadStarted), recognizeStarted = performance.now();
        try {
          const result = await currentEngine.recognize(canvas);
          const elapsedMs = round(performance.now()-recognizeStarted);
          if(typeof result.text !== 'string' || !Array.isArray(result.words)) throw Error('Unexpected real OCR response');
          report.results.push({id:fixture.id, engine:'tesseract-7-auto', output_format:'plain', text:result.text,
            confidence:result.confidence, words:result.words, word_count:result.words.length, chosen_psm:result.psm,
            elapsed_ms:elapsedMs, fixture_load_ms:fixtureLoadMs, model_load_ms:index===0?report.session.model_load_ms:0,
            resize:'none', input:{width:canvas.width,height:canvas.height,image:fixture.image,sha256:fixture.sha256,bytes:fixture.bytes},
            notes:'One actual shared PDFOCR.session. Automatic layout uses the current app selection between real PSM 3 and PSM 6 passes; text is unmodified.'});
          publish();
        } finally {
          canvas.width=canvas.height=0;image.src='';
        }
      }
      report.status = 'complete';
      status.textContent = '완료 · 실제 Tesseract 엔진으로 3 / 3개 이미지 인식';
    } catch(error) {
      report.status = 'error';
      report.error = {name:error.name, message:error.message, failed_fixture:active};
      status.textContent = '실패 · ' + active + ' · ' + error.message;
    } finally {
      await currentEngine?.close(); currentEngine=null;
      report.total_ms = round(performance.now()-started);
      report.external_resources = resourceAudit();
      report.csp_violations = window.__baselineCspViolations.slice();
      report.network_policy = "connect-src 'self' blob: data:; images embedded; OCR engine and languages embedded";
      if(report.external_resources.length) {
        report.status='error';report.error={name:'ExternalResourceError',message:'An external resource was observed'};
        status.textContent='외부 리소스가 관측되어 검증 실패로 처리했습니다.';
      }
      publish();running=false;button.disabled=false;button.textContent='실제 인식 다시 실행';
    }
  });
  addEventListener('pagehide',()=>{controller?.abort();void currentEngine?.close();});
})();
</script>`;
html = html.replace('</body>', harness + '\n</body>');
const target = path.join(out, 'tesseract-baseline.html');
fs.writeFileSync(target, html);
console.log(JSON.stringify({file:target, bytes:Buffer.byteLength(html), source_index_sha256:sha(source), fixtures:fixtures.map(({id,sha256,width,height})=>({id,sha256,width,height})), csp, mocked:false}, null, 2));
