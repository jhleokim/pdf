
"use strict";
/* ── 인라인 자산 어댑터 ──────────────────────────────────────────
   pdf.js가 네트워크로 받아오던 cmap/표준폰트를 파일 내부에서 공급 */
function b64bytes(s){
  const bin = atob(s), u = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
  return u;
}
class InlineCMapReaderFactory{
  constructor(){}
  async fetch({ name }){
    const d = INLINE_CMAPS[name];
    if(!d) throw new Error('내장되지 않은 CMap: ' + name);
    return { cMapData: b64bytes(d), compressionType: 1 };
  }
}
class InlineStandardFontDataFactory{
  constructor(){}
  async fetch({ filename }){
    const d = INLINE_FONTS[filename] || INLINE_FONTS[filename + '.pfb'] || INLINE_FONTS[filename + '.ttf'];
    if(!d) throw new Error('내장되지 않은 표준폰트: ' + filename);
    return b64bytes(d);
  }
}
const DOC_OPTS = {
  isEvalSupported: false,
  cMapUrl: 'inline/', cMapPacked: true, CMapReaderFactory: InlineCMapReaderFactory,
  standardFontDataUrl: 'inline/', StandardFontDataFactory: InlineStandardFontDataFactory,
};
// 워커 스크립트를 본문에 인라인했으므로 globalThis.pdfjsWorker 가 이미 존재한다.
// pdf.js는 이를 감지해 별도 파일 요청 없이 메인스레드 워커로 동작한다.
const { PDFDocument, degrees, rgb,
  pushGraphicsState, popGraphicsState, setGraphicsState,
  moveTo, appendBezierCurve, closePath, fillAndStroke, stroke: opStroke,
  setLineWidth, setStrokingColor, setFillingColor, setDashPattern } = PDFLib;

/* ── 상태 ── */
const SWATCH = ['#00806a','#3B6FB6','#B5651D','#7B4EA8','#0E8A9E','#A8322F','#5D7A34','#8A6D1F'];
const docs = new Map();
const stamps = new Map();                 // 페이지 위에 붙인 사진 원본
let pages = [], origCount = 0, docSeq = 0, uidSeq = 0, stampSeq = 0;
let lastClicked = null, previewUid = null;

const $ = id => document.getElementById(id);
const board = $('board');
const idle = () => new Promise(r => setTimeout(r, 0));
const esc = s => String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));

function toast(msg, isErr){
  const t = $('toast');
  t.innerHTML = '<svg class="ic"><use href="#i-' + (isErr ? 'alert' : 'check') + '"/></svg><span></span>';
  t.querySelector('span').textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(t._t); t._t = setTimeout(() => t.className = '', 3400);
}
const progress = p => $('bar').style.width = (p <= 0 || p >= 100 ? 0 : p) + '%';
const busy = (on, label) => { $('busyText').textContent = label || '처리 중…'; $('busy').classList.toggle('on', !!on); document.body.classList.toggle('is-busy',!!on); };
const buzz = ms => { try{ navigator.vibrate && navigator.vibrate(ms); }catch(_){} };

/* ════════════════════════════════════════════════════════════
   파일 적재 — PDF는 그대로, 사진은 1페이지 PDF로 변환해 합류
   ════════════════════════════════════════════════════════════ */
const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i;
const isImage = f => (f.type && f.type.startsWith('image/')) || IMG_RE.test(f.name);
const isPdf   = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

// 캔버스를 거쳐 PNG로 표준화 (webp·gif·bmp·avif 등 pdf-lib이 못 읽는 형식 대응)
async function toPngBytes(file){
  const url = URL.createObjectURL(file);
  try{
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('이미지 디코딩 실패'));
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }finally{ URL.revokeObjectURL(url); }
}

async function embedAnyImage(doc, file){
  const type = (file.type || '').toLowerCase();
  const raw = new Uint8Array(await file.arrayBuffer());
  if(/jpe?g/.test(type) || /\.jpe?g$/i.test(file.name)){
    try{ return { img: await doc.embedJpg(raw), bytes: raw, mime: 'image/jpeg' }; }catch(_){}
  }
  if(/png/.test(type) || /\.png$/i.test(file.name)){
    try{ return { img: await doc.embedPng(raw), bytes: raw, mime: 'image/png' }; }catch(_){}
  }
  const png = await toPngBytes(file);                 // 그 외 형식·손상 헤더는 캔버스 경유
  return { img: await doc.embedPng(png), bytes: png, mime: 'image/png' };
}

// 사진 한 장 → A4 판형에 꽉 맞춘 1페이지 PDF
async function imageToPdfBytes(file){
  const doc = await PDFDocument.create();
  const { img } = await embedAnyImage(doc, file);
  const land = img.width > img.height;
  const boxW = land ? 841.89 : 595.28, boxH = land ? 595.28 : 841.89;
  const s = Math.min(boxW / img.width, boxH / img.height);
  const w = Math.round(img.width * s), h = Math.round(img.height * s);
  const page = doc.addPage([w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  return doc.save({ useObjectStreams: true });
}

async function loadFiles(fileList){
  if(document.body.classList.contains('is-busy')) return;
  const all = [...fileList];
  const files = all.filter(f => isPdf(f) || isImage(f));
  if(!files.length){ toast('PDF 또는 이미지 파일만 추가할 수 있습니다', true); return; }
  if(files.length < all.length) toast(`지원하지 않는 파일 ${all.length - files.length}개는 건너뜁니다`, true);

  busy(true, '문서를 읽는 중…');
  await idle();
  for(const file of files){
    try{
      const image = !isPdf(file) && isImage(file);
      busy(true, `${file.name} — ${image ? '사진을 페이지로 변환 중…' : '여는 중…'}`);
      await idle();

      const raw = image ? await imageToPdfBytes(file) : new Uint8Array(await file.arrayBuffer());
      const libBytes = raw.slice(0);           // pdf.js가 원본 버퍼를 가져가므로 사본 확보
      const pdf = await pdfjsLib.getDocument({ data: raw, ...DOC_OPTS }).promise;

      const docId = 'd' + (++docSeq);
      docs.set(docId, { name: file.name, libBytes, pdfjsDoc: pdf, kind: image ? 'image' : 'pdf',
        color: SWATCH[(docSeq - 1) % SWATCH.length], count: pdf.numPages });

      for(let i = 1; i <= pdf.numPages; i++){
        const canvas = await renderThumb(pdf, i);
        pages.push({ uid: 'p' + (++uidSeq), docId, srcIndex: i - 1, rotation: 0, canvas });
        origCount++;
        if(pdf.numPages > 1) busy(true, `${file.name} — ${i}/${pdf.numPages}페이지`);
        progress(i / pdf.numPages * 100);
        if(i % 4 === 0) await idle();          // 메인스레드 양보 (UI 멈춤 방지)
      }
    }catch(e){
      console.error(e);
      const m = e && e.message || '';
      const msg = /password/i.test(m) ? '암호가 설정된 파일입니다'
        : /디코딩/.test(m) ? '이미지를 읽을 수 없습니다'
        : '손상되었거나 읽을 수 없는 파일입니다';
      toast(`${file.name} — ${msg}`, true);
    }
  }
  busy(false); progress(0);
  render();
  if(pages.length && !previewUid) showPreview(pages[0]);
}

async function renderThumb(pdf, pageNo){
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(300 / base.width, 380 / base.height) * dpr;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return canvas;
}

/* ════════════════════════════════════════════════════════════
   렌더링
   ════════════════════════════════════════════════════════════ */
function render(){
  const has = pages.length > 0 || docs.size > 0;
  $('empty').hidden = has;
  $('boardWrap').hidden = !has;
  $('previewPanel').hidden = !has;
  $('colsCtrl').hidden = !has;
  $('divider').hidden = !has;
  $('drawer').hidden = !has;
  $('btnPreview').hidden = !has;
  $('btnInfo').hidden = !has;
  $('viewSwitch').hidden = !has;
  $('actionBar').hidden = !has;
  measureActionBar();
  if(!has) setMobileView('board');
  syncPreviewVisible();

  if(previewUid && !pages.some(p => p.uid === previewUid)) previewUid = null;

  board.innerHTML = '';
  const frag = document.createDocumentFragment();
  pages.forEach((p, idx) => frag.appendChild(makeCard(p, idx)));
  board.appendChild(frag);

  renderInfo();

  const shown = pages.find(p => p.uid === previewUid);
  if(shown) setPvTitle(shown);
  syncCounts();
}

function renderInfo(){
  const list = [...docs].map(([id, d]) => `
    <div class="doc-item">
      <div class="doc-swatch" style="background:${d.color}"></div>
      <div style="min-width:0">
        <div class="doc-name"><svg class="ic"><use href="#i-${d.kind === 'image' ? 'photo' : 'file'}"/></svg>${esc(d.name)}</div>
        <div class="doc-meta">원본 ${d.count}p · 현재 ${pages.filter(x => x.docId === id).length}p 사용</div>
      </div>
    </div>`).join('') || '<div class="doc-meta">불러온 문서가 없습니다</div>';

  const stats = `
    <div class="stat-row"><span>원본 페이지</span><b>${origCount}</b></div>
    <div class="stat-row${pages.length !== origCount ? ' changed' : ''}"><span>현재 페이지</span><b>${pages.length}</b></div>
    <div class="stat-row"><span>선택됨</span><b>${selected().length}</b></div>
    <div class="stat-row"><span>강조 표시</span><b>${pages.reduce((n, p) => n + (p.annots ? p.annots.length : 0), 0)}</b></div>`;

  $('infoDesktop').innerHTML =
    `<div class="dc-block"><div class="label">불러온 문서</div>${list}</div>` +
    `<div class="dc-block"><div class="label">현황</div>${stats}</div>`;
  $('infoMobile').innerHTML =
    `<div class="dc-block"><div class="label">불러온 문서</div>${list}</div>` +
    `<div class="dc-block"><div class="label">현황</div>${stats}</div>`;
}

function syncCounts(){
  const n = selected().length, any = pages.length > 0;
  $('lgCount').textContent = pages.length;
  $('segBoardN').textContent = pages.length;
  $('dtBadge').textContent = pages.length + 'p';
  $('selN').textContent = n;
  $('selBar').style.display = n ? 'flex' : 'none';
  document.body.classList.toggle('selmode', n > 0);
  measureActionBar();

  ['btnRotL','btnRotR','btnDel','mbRotL','mbRotR','mbDel'].forEach(id => $(id).disabled = n === 0);
  ['btnAll','btnSave','btnReset','mbSave'].forEach(id => $(id).disabled = !any);
  const all = any && n === pages.length;
  $('btnAll').lastChild.textContent = all ? '전체 해제' : '전체 선택';
  $('mbAll').textContent = all ? '전체 해제' : '전체';
  for(const id of ['btnAll','mbAll']) $(id).setAttribute('aria-pressed',String(all));
  const stat = $('infoDesktop').querySelectorAll('.stat-row b')[2];
  if(stat) stat.textContent = n;
  const stat2 = $('infoMobile').querySelectorAll('.stat-row b')[2];
  if(stat2) stat2.textContent = n;
  if(typeof syncProState === 'function') syncProState();
}

// 하단 액션바가 가리는 높이를 CSS 변수로 알려 미리보기 맞춤 배율이 어긋나지 않게 한다
function measureActionBar(){
  const bar = $('actionBar');
  const h = (bar.hidden || getComputedStyle(bar).display === 'none') ? 0 : bar.offsetHeight;
  document.documentElement.style.setProperty('--abH', h + 'px');
}

function makeCard(p, idx){
  const d = docs.get(p.docId);
  const el = document.createElement('div');
  el.className = 'page'; el.draggable = true; el.dataset.uid = p.uid; el.tabIndex = 0;
  el.innerHTML = `
    <div class="sheet">
      <div class="spine" style="background:${d.color}"></div>
      ${p.rotation ? `<div class="rot-tag">${p.rotation}°</div>` : ''}
      ${d.kind === 'image' ? '<div class="img-tag" title="사진에서 만든 페이지"><svg class="ic"><use href="#i-photo"/></svg></div>' : ''}
    </div>
    <div class="plate">${idx + 1}</div>
    <div class="pick"><svg class="ic"><use href="#i-check"/></svg></div>
    <div class="pfoot">
      <span class="src" title="${esc(d.name)} · 원본 ${p.srcIndex + 1}p">${esc(d.name)}</span>
      <span class="acts">
        <button class="icon-btn" data-act="rot" title="오른쪽 회전"><svg class="ic"><use href="#i-rot-r"/></svg></button>
        <button class="icon-btn del" data-act="del" title="삭제"><svg class="ic"><use href="#i-trash"/></svg></button>
      </span>
    </div>`;
  const c = p.canvas.cloneNode(true);
  c.getContext('2d').drawImage(p.canvas, 0, 0);
  c.style.transform = `rotate(${p.rotation}deg)`;
  if(p.rotation % 180){ c.style.maxWidth = '75%'; c.style.maxHeight = '133%'; }
  el.querySelector('.sheet').appendChild(c);
  p.el = el;
  if(p.uid === previewUid) el.classList.add('previewing');

  el.querySelector('[data-act="rot"]').onclick = e => { e.stopPropagation(); rotate([p], 90); };
  el.querySelector('[data-act="del"]').onclick = e => { e.stopPropagation(); remove([p]); };
  el.ondblclick = () => { if(isMobile()) setMobileView('preview'); else preview(p); };
  el.onclick = e => select(pages.indexOf(p), e);
  return el;
}

/* ── 선택 ── */
const selected = () => pages.filter(p => p.el && p.el.classList.contains('selected'));
function select(idx, e){
  if(idx < 0) return;
  if(e.shiftKey && lastClicked !== null){
    const a = Math.min(lastClicked, idx), b = Math.max(lastClicked, idx);
    for(let i = a; i <= b; i++) pages[i].el.classList.add('selected');
  }else if(e.ctrlKey || e.metaKey || (isMobile() && selected().length > 1)){
    pages[idx].el.classList.toggle('selected');
  }else{
    pages.forEach(p => p.el.classList.remove('selected'));
    pages[idx].el.classList.add('selected');
  }
  lastClicked = idx;
  showPreview(pages[idx]);
  syncCounts();
}

/* ════════════════════════════════════════════════════════════
   미리보기
   ════════════════════════════════════════════════════════════ */
let pvToken = 0, pvZoom = 1, pvFitScale = 1, pvScale = 1, pvRenderTask=null;
const PV_ZOOM_MIN = 0.4, PV_ZOOM_MAX = 8;
const previewVisible = () => !$('previewPanel').hidden &&
  !(mainEl.classList.contains('preview-off')) &&
  !(mainEl.classList.contains('layout-mobile') && !mainEl.classList.contains('view-preview'));

function setPvTitle(p){
  const d = docs.get(p.docId);
  $('pvT1').textContent = `${pages.indexOf(p) + 1}번 페이지`;
  $('pvT2').textContent = `${d.name} · 원본 ${p.srcIndex + 1}p`;
}

async function showPreview(p){
  if(!p) return;
  if(p.uid!==previewUid){if(typeof textUpdate!=='undefined')await textUpdate;if(typeof finishTextEdit==='function'&&!finishTextEdit(true))return;selAnno=null;}
  const my=++pvToken;pvRenderTask?.cancel();pvRenderTask=null;
  previewUid = p.uid;
  pages.forEach(x => x.el && x.el.classList.toggle('previewing', x.uid === p.uid));
  setPvTitle(p);
  if(typeof syncLivePreview === 'function') syncLivePreview();
  if(document.body.dataset.mode === 'pro') return;
  if(!previewVisible()) return;               // 안 보이면 렌더링 비용을 쓰지 않는다

  $('pvPlaceholder').hidden = true;
  $('pvZoomCtrl').hidden = false;

  const d = docs.get(p.docId);
  const page = await d.pdfjsDoc.getPage(p.srcIndex + 1);
  if(my !== pvToken) return;

  $('annoBar').hidden = false;
  const box = $('pvBody').getBoundingClientRect();
  const rot = (page.getViewport({ scale: 1 }).rotation + p.rotation) % 360;
  const probe = page.getViewport({ scale: 1, rotation: rot });
  const pad = isMobile() ? 20 : 36;
  pvFitScale = Math.max(0.05, Math.min((box.width - pad) / probe.width, (box.height - pad) / probe.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cssScale = Math.min(pvFitScale * pvZoom, 8, Math.sqrt(16000000/(probe.width*probe.height))/dpr);
  const vp = page.getViewport({ scale: cssScale * dpr, rotation: rot });

  const c = document.createElement('canvas');c.id='pvCanvas';
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  c.style.width = Math.floor(vp.width / dpr) + 'px';
  c.style.height = Math.floor(vp.height / dpr) + 'px';
  const task=page.render({canvasContext:c.getContext('2d'),viewport:vp});pvRenderTask=task;
  try{await task.promise;}catch(e){c.width=c.height=0;if(my!==pvToken||e.name==='RenderingCancelledException')return;throw e;}
  finally{if(pvRenderTask===task)pvRenderTask=null;}
  if(my !== pvToken){c.width=c.height=0;return;}
  const old=$('pvCanvas');c.setAttribute('aria-label',old.getAttribute('aria-label')||'페이지 미리보기');old.replaceWith(c);old.width=old.height=0;

  $('pvStage').hidden = false;
  $('pvZoomVal').textContent = Math.round(pvZoom * 100) + '%';
  $('annoBar').hidden = false;
  pvScale = cssScale;                         // pt → CSS px
  layoutOverlay(c.width, c.height);
  renderAnnots();
}
function setZoom(z){
  pvZoom = clamp(z, PV_ZOOM_MIN, PV_ZOOM_MAX);
  $('pvZoomVal').textContent = Math.round(pvZoom * 100) + '%';
  const p = pages.find(x => x.uid === previewUid);
  if(p) showPreview(p);
}
function clearPreview(){
  if(typeof finishTextEdit==='function')finishTextEdit(false);
  pvRenderTask?.cancel();pvRenderTask=null;$('pvCanvas').width=$('pvCanvas').height=0;
  previewUid = null; pvToken++; pvZoom = 1; selAnno = null;
  $('pvStage').hidden = true; $('pvPlaceholder').hidden = false;
  $('pvZoomCtrl').hidden = true; $('annoBar').hidden = true;
  $('pvOverlay').innerHTML = '';
  $('pvT1').textContent = '미리보기'; $('pvT2').textContent = '페이지를 선택하세요';
  $('pvZoomVal').textContent = '100%';
}

/* ════════════════════════════════════════════════════════════
   영역 강조 · 사진 붙이기 (주석)
   좌표는 표시공간 정규화값(nx,ny,nw,nh: 0~1) → 줌/폭 변화에 안전
   ════════════════════════════════════════════════════════════ */
const SVGNS = 'http://www.w3.org/2000/svg';
let annoUidSeq = 0, selAnno = null, pendingStamp = null;
const annoStyle = { tool:'none', stroke:'#BF342E', fill:'#FFE082', lineWidth:2, dash:'solid', opacity:0.35 };
const curAnnots = () => { const p = pages.find(x => x.uid === previewUid); return p ? (p.annots ||= []) : []; };

function layoutOverlay(w, h){
  const ov = $('pvOverlay');
  ov.setAttribute('viewBox', `0 0 ${w} ${h}`);
}
function hexToRgb(hex){
  const n = parseInt(hex.slice(1), 16);
  return { r:(n>>16&255)/255, g:(n>>8&255)/255, b:(n&255)/255 };
}
// 사각형 둘레를 따라 바깥쪽 범프(구름) 제어점 생성 — 중심에서 바깥으로 밀어 방향 무관
function cloudSamples(x, y, w, h, r){
  const cx = x + w/2, cy = y + h/2;
  const corners = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
  const pts = [];
  for(let e=0;e<4;e++){
    const A = corners[e], B = corners[(e+1)%4];
    const len = Math.hypot(B[0]-A[0], B[1]-A[1]);
    const n = Math.max(1, Math.round(len/(2*r)));
    for(let i=0;i<n;i++) pts.push([A[0]+(B[0]-A[0])*i/n, A[1]+(B[1]-A[1])*i/n]);
  }
  const segs = [];
  for(let i=0;i<pts.length;i++){
    const P = pts[i], Q = pts[(i+1)%pts.length];
    const mx = (P[0]+Q[0])/2, my = (P[1]+Q[1])/2;
    let ox = mx-cx, oy = my-cy; const d = Math.hypot(ox,oy)||1; ox/=d; oy/=d;
    const push = r*1.15;
    segs.push({ P, Q, C1:[P[0]+ox*push, P[1]+oy*push], C2:[Q[0]+ox*push, Q[1]+oy*push] });
  }
  return { start:pts[0], segs };
}
function cloudPathD(x, y, w, h, r){
  const { start, segs } = cloudSamples(x, y, w, h, r);
  let d = `M ${start[0]} ${start[1]} `;
  for(const s of segs) d += `C ${s.C1[0]} ${s.C1[1]} ${s.C2[0]} ${s.C2[1]} ${s.Q[0]} ${s.Q[1]} `;
  return d + 'Z';
}
const cloudRadius = (w, h) => Math.max(5, Math.min(16, Math.min(w, h)/8));

// 사진 주석은 원본 비율을 유지한다
function fixAspect(a, w, h){
  const st = stamps.get(a.stamp); if(!st) return;
  const px = Math.abs(a.nw) * w;
  a.nh = (px / st.ratio) / h;
}

function annoToSVG(a, w, h){
  if(a.shape==='text')return PDFMarkupText.svg(a,w,h);
  const x = a.nx*w, y = a.ny*h, bw = a.nw*w, bh = a.nh*h;
  let el;
  if(a.shape === 'image'){
    const st = stamps.get(a.stamp);
    el = document.createElementNS(SVGNS,'image');
    el.setAttributeNS('http://www.w3.org/1999/xlink','href', st ? st.url : '');
    el.setAttribute('href', st ? st.url : '');
    el.setAttribute('x', Math.min(x, x+bw)); el.setAttribute('y', Math.min(y, y+bh));
    el.setAttribute('width', Math.abs(bw)); el.setAttribute('height', Math.abs(bh));
    el.setAttribute('preserveAspectRatio','none');
    el.setAttribute('opacity', a.opacity);
    el.setAttribute('class','anno'); el.dataset.uid = a.id;
    return el;
  }
  const sw = a.lineWidth * pvScale;
  const dash = a.dash === 'dashed' ? `${sw*3} ${sw*2}` : '';
  if(a.shape === 'ellipse'){
    el = document.createElementNS(SVGNS,'ellipse');
    el.setAttribute('cx', x+bw/2); el.setAttribute('cy', y+bh/2);
    el.setAttribute('rx', Math.abs(bw/2)); el.setAttribute('ry', Math.abs(bh/2));
  }else if(a.shape === 'cloud'){
    el = document.createElementNS(SVGNS,'path');
    el.setAttribute('d', cloudPathD(x, y, bw, bh, cloudRadius(bw,bh)*pvScale));
  }else{
    el = document.createElementNS(SVGNS,'rect');
    el.setAttribute('x', Math.min(x, x+bw)); el.setAttribute('y', Math.min(y, y+bh));
    el.setAttribute('width', Math.abs(bw)); el.setAttribute('height', Math.abs(bh));
  }
  el.setAttribute('fill', a.fill || 'none');
  el.setAttribute('fill-opacity', a.fill ? a.opacity : 0);
  el.setAttribute('stroke', a.stroke);
  el.setAttribute('stroke-opacity', 1);
  el.setAttribute('stroke-width', sw);
  if(dash) el.setAttribute('stroke-dasharray', dash);
  el.setAttribute('class','anno'); el.dataset.uid = a.id;
  if(a.shape==='highlight'){el.setAttribute('stroke','none');el.style.mixBlendMode='multiply';}
  return el;
}
function renderAnnots(){
  const ov = $('pvOverlay'); ov.innerHTML = '';
  const c = $('pvCanvas'), w = c.width, h = c.height;
  const list = curAnnots();
  list.forEach(a => ov.appendChild(annoToSVG(a, w, h)));
  if(selAnno){
    const a = list.find(x => x.id === selAnno);
    if(a){
      const x = a.nx*w, y = a.ny*h, bw = a.nw*w, bh = a.nh*h;
      const box = document.createElementNS(SVGNS,'rect');
      box.setAttribute('x', Math.min(x,x+bw)); box.setAttribute('y', Math.min(y,y+bh));
      box.setAttribute('width', Math.abs(bw)); box.setAttribute('height', Math.abs(bh));
      box.setAttribute('class','selbox'); ov.appendChild(box);
      const hs = (isMobile()?6:4) * (c.width / (c.clientWidth || c.width));
      [[x,y,'nw'],[x+bw,y,'ne'],[x+bw,y+bh,'se'],[x,y+bh,'sw']].forEach(([hx,hy,pos]) => {
        const hd = document.createElementNS(SVGNS,'rect');
        hd.setAttribute('x', hx-hs); hd.setAttribute('y', hy-hs);
        hd.setAttribute('width', hs*2); hd.setAttribute('height', hs*2);
        hd.setAttribute('class','handle'); hd.dataset.h = pos; ov.appendChild(hd);
      });
    }
  }
  $('annoDel').disabled = !selAnno;
  $('annoClear').disabled = list.length === 0;
  syncAnnotationControls();
}

/* ── 오버레이 포인터: 그리기 / 선택 / 이동 / 리사이즈 ── */
let drag = null, pinch = null;
function stagePx(e){
  const c = $('pvCanvas'), r = c.getBoundingClientRect();
  return { x:(e.clientX - r.left) * (c.width / r.width), y:(e.clientY - r.top) * (c.height / r.height) };
}
$('pvOverlay').addEventListener('pointerdown', e => {
  if($('pvStage').hidden || pinch) return;
  if(typeof finishTextEdit==='function'&&!finishTextEdit(true))return;
  const c = $('pvCanvas'), w = c.width, h = c.height;
  const pt = stagePx(e);
  const handle = e.target.dataset && e.target.dataset.h;
  if(annoStyle.tool==='text'){e.preventDefault();openTextEditor({x:pt.x/w,y:pt.y/h});return;}
  const hit=e.target.closest('.anno');

  if(annoStyle.tool === 'none'){
    if(handle && selAnno){
      drag = { mode:'resize', a: curAnnots().find(x => x.id === selAnno), pos: handle };
    }else if(hit){
      selAnno = hit.dataset.uid;
      const a = curAnnots().find(x => x.id === selAnno);
      if(a.shape !== 'image'&&a.shape!=='text'){ Object.assign(annoStyle,{stroke:a.stroke==='none'?annoStyle.stroke:a.stroke,fill:a.fill,lineWidth:a.lineWidth||2,dash:a.dash,opacity:a.opacity}); }
      drag = { mode:'move', a, ox: pt.x - a.nx*w, oy: pt.y - a.ny*h };
      renderAnnots();
    }else{ selAnno = null; renderAnnots(); }
  }else if(annoStyle.tool === 'image'){
    if(!pendingStamp){ openStampPicker(); return; }
    const a = { id:'a'+(++annoUidSeq), shape:'image', stamp:pendingStamp,
      nx: pt.x/w, ny: pt.y/h, nw:0, nh:0, opacity:1 };
    curAnnots().push(a); selAnno = a.id;
    drag = { mode:'create', a, sx: pt.x, sy: pt.y };
  }else{
    const a = { id:'a'+(++annoUidSeq), shape: annoStyle.tool, nx: pt.x/w, ny: pt.y/h, nw:0, nh:0,
      stroke: annoStyle.stroke, fill: annoStyle.fill, lineWidth: annoStyle.lineWidth,
      dash: annoStyle.dash, opacity: annoStyle.opacity };
    if(a.shape==='highlight'){a.stroke='none';a.lineWidth=0;a.fill||='#ffe082';}
    curAnnots().push(a); selAnno = a.id;
    drag = { mode:'create', a, sx: pt.x, sy: pt.y };
  }
  if(drag){ try{ $('pvOverlay').setPointerCapture(e.pointerId); }catch(_){} e.preventDefault(); }
});
$('pvOverlay').addEventListener('pointermove', e => {
  if(!drag || pinch) return;
  const c = $('pvCanvas'), w = c.width, h = c.height, pt = stagePx(e);
  const a = drag.a; if(!a) return;
  if(drag.mode === 'create'){
    a.nx = Math.min(drag.sx, pt.x)/w; a.ny = Math.min(drag.sy, pt.y)/h;
    a.nw = Math.abs(pt.x - drag.sx)/w; a.nh = Math.abs(pt.y - drag.sy)/h;
    if(a.shape === 'image') fixAspect(a, w, h);
  }else if(drag.mode === 'move'){
    a.nx = (pt.x - drag.ox)/w; a.ny = (pt.y - drag.oy)/h;
  }else if(drag.mode === 'resize'){
    let x1 = a.nx*w, y1 = a.ny*h, x2 = x1 + a.nw*w, y2 = y1 + a.nh*h;
    if(drag.pos.includes('w')) x1 = pt.x;
    if(drag.pos.includes('e')) x2 = pt.x;
    if(drag.pos.includes('n')) y1 = pt.y;
    if(drag.pos.includes('s')) y2 = pt.y;
    a.nx = Math.min(x1,x2)/w; a.ny = Math.min(y1,y2)/h;
    a.nw = Math.abs(x2-x1)/w; a.nh = Math.abs(y2-y1)/h;
    if(a.shape === 'image'){ fixAspect(a, w, h); if(drag.pos.includes('n')) a.ny = Math.max(y1,y2)/h - a.nh; }
  }
  renderAnnots();
});
function endDrag(){
  if(drag && drag.mode === 'create'){
    const a = drag.a;
    const c = $('pvCanvas'), w = c.width, h = c.height;
    if(a.shape === 'image' && (a.nw < 0.02 || a.nh < 0.02)){
      a.nw = 0.34; fixAspect(a, w, h);                    // 탭 한 번 = 기본 크기로 배치
      a.nx = clamp(a.nx, 0, 1 - a.nw); a.ny = clamp(a.ny, 0, Math.max(0, 1 - a.nh));
    }else if(a.shape !== 'image' && (a.nw < 0.008 || a.nh < 0.008)){
      const arr = curAnnots(); const i = arr.indexOf(a); if(i >= 0) arr.splice(i,1);
      selAnno = null;
    }
    if(a.shape === 'image'){ pendingStamp = null; renderInfo(); }
    setTool('none');
  }
  drag = null; renderAnnots(); syncCounts();
}
$('pvOverlay').addEventListener('pointerup', endDrag);
$('pvOverlay').addEventListener('pointercancel', endDrag);

/* ── 사진 붙이기 ── */
function openStampPicker(){ $('stampInput').click(); }
$('stampInput').onchange = async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if(!file) return;
  busy(true, '사진을 준비하는 중…');
  try{
    let bytes, mime;
    const t = (file.type || '').toLowerCase();
    if(/jpe?g/.test(t)){ bytes = new Uint8Array(await file.arrayBuffer()); mime = 'image/jpeg'; }
    else if(/png/.test(t)){ bytes = new Uint8Array(await file.arrayBuffer()); mime = 'image/png'; }
    else { bytes = await toPngBytes(file); mime = 'image/png'; }

    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const dim = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
      i.onerror = () => rej(new Error('이미지 디코딩 실패'));
      i.src = url;
    });
    const key = 's' + (++stampSeq);
    stamps.set(key, { bytes, mime, url, name: file.name, ratio: dim.w / Math.max(1, dim.h) });
    pendingStamp = key;
    setTool('image');
    toast('페이지 위를 드래그하면 사진이 놓입니다');
  }catch(err){
    console.error(err); toast('사진을 읽을 수 없습니다', true); setTool('none');
  }finally{ busy(false); }
};

/* ════════════════════════════════════════════════════════════
   편집
   ════════════════════════════════════════════════════════════ */
async function insertBlankPage(options={}){
  if(document.body.classList.contains('is-busy')) return;
  if(typeof textUpdate!=='undefined')await textUpdate;
  if(document.body.classList.contains('is-busy')||(typeof finishTextEdit==='function'&&!finishTextEdit(true)))return;
  const selection=selected(),explicit=Object.hasOwn(options,'beforeUid');
  const at=explicit?(options.beforeUid?pages.findIndex(p=>p.uid===options.beforeUid):pages.length):(selection.length?pages.indexOf(selection.at(-1))+1:0);
  if(at<0)return;
  const anchor=pages[Math.max(0,at-1)];
  const positions=typeof captureBoardPositions==='function'?captureBoardPositions():null;
  busy(true,'빈 페이지를 추가하는 중…');
  let pdf;
  try{
    let width=595.28,height=841.89;
    if(anchor){
      const source=await docs.get(anchor.docId).pdfjsDoc.getPage(anchor.srcIndex+1);
      const [x1,y1,x2,y2]=source.view,unit=source.userUnit||1;
      width=(x2-x1)*unit;height=(y2-y1)*unit;
      if((source.rotate+anchor.rotation)%180!==0)[width,height]=[height,width];
    }
    const blank=await PDFDocument.create();blank.addPage([width,height]);
    const libBytes=await blank.save({useObjectStreams:true});
    pdf=await pdfjsLib.getDocument({data:libBytes.slice(),...DOC_OPTS}).promise;
    const canvas=await renderThumb(pdf,1),docId='d'+(++docSeq);
    const page={uid:'p'+(++uidSeq),docId,srcIndex:0,rotation:0,canvas};
    docs.set(docId,{name:'빈 페이지',libBytes,pdfjsDoc:pdf,kind:'blank',color:SWATCH[(docSeq-1)%SWATCH.length],count:1});
    pdf=null;
    pages.splice(at,0,page);render();
    page.el.classList.add('selected');lastClicked=at;syncCounts();
    if(positions)animateBoardFrom(positions,page.uid);
    await showPreview(page);
    page.el.scrollIntoView({block:'nearest',inline:'nearest'});
    toast(`${at+1}번에 빈 페이지를 추가했습니다`);
  }catch(e){
    if(pdf)await pdf.destroy().catch(()=>{});
    toast('빈 페이지를 추가하지 못했습니다. 다시 시도해 주세요.',true);
  }finally{busy(false);}
}
function remove(list){
  if(!list.length) return;
  const set = new Set(list.map(p => p.uid));
  const hit = set.has(previewUid);
  pages = pages.filter(p => !set.has(p.uid));
  lastClicked = null;
  if(hit) clearPreview();
  render();
  toast(`${list.length}개 페이지를 삭제했습니다`);
}
function rotate(list, deg){
  if(!list.length) return;
  list.forEach(p => p.rotation = ((p.rotation + deg) % 360 + 360) % 360);
  const keep = new Set(list.map(p => p.uid));
  render();
  pages.forEach(p => { if(keep.has(p.uid)) p.el.classList.add('selected'); });
  const shown = pages.find(p => p.uid === previewUid);
  if(shown && keep.has(shown.uid)) showPreview(shown);
  syncCounts();
}

/* ── 순서 변경 공통 커밋 ── */
function commitMove(uids, anchorUid){
  const set = new Set(uids);
  const block = pages.filter(p => set.has(p.uid));
  if(!block.length) return;
  const rest = pages.filter(p => !set.has(p.uid));
  let at = anchorUid ? rest.findIndex(p => p.uid === anchorUid) : rest.length;
  if(at < 0) at = rest.length;
  rest.splice(at, 0, ...block);
  pages = rest;
  lastClicked = null;
  render();
  block.forEach(p => { const el = pages.find(x => x.uid === p.uid)?.el; if(el) el.classList.add('selected'); });
  syncCounts();
}

/* ── 데스크톱: HTML5 드래그 ── */
let dragUids = [];
const marker = document.createElement('div');
marker.className = 'drop-marker';

board.addEventListener('dragstart', e => {
  const card = e.target.closest('.page'); if(!card) return;
  const uid = card.dataset.uid;
  const sel = selected();
  dragUids = (sel.length > 1 && sel.some(p => p.uid === uid))
    ? pages.filter(p => sel.includes(p)).map(p => p.uid) : [uid];
  dragUids.forEach(u => { const p = pages.find(x => x.uid === u); if(p && p.el) p.el.classList.add('dragging'); });
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', uid);
});
board.addEventListener('dragend', () => {
  dragUids = []; marker.remove();
  board.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
});
board.addEventListener('dragover', e => {
  if(!dragUids.length) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  const after = cardAfter(e.clientX, e.clientY);
  after ? board.insertBefore(marker, after) : board.appendChild(marker);
});
board.addEventListener('drop', e => {
  if(!dragUids.length) return;
  e.preventDefault();
  const set = new Set(dragUids);
  let anchorUid = null, sib = marker.nextElementSibling;
  while(sib){ if(!set.has(sib.dataset.uid)){ anchorUid = sib.dataset.uid; break; } sib = sib.nextElementSibling; }
  marker.remove();
  const uids = dragUids; dragUids = [];
  commitMove(uids, anchorUid);
});
function cardAfter(x, y){
  const cards = [...board.querySelectorAll('.page:not(.dragging)')];
  return cards.find(c => {
    const r = c.getBoundingClientRect();
    return y < r.bottom && x < r.left + r.width / 2;
  }) || cards.find(c => y < c.getBoundingClientRect().top);
}

/* ── 모바일: 길게 눌러 드래그 ── */
let tdrag = null;
const HOLD_MS = 330, MOVE_TOL = 12;

board.addEventListener('pointerdown', e => {
  if(e.pointerType === 'mouse' || e.isPrimary === false) return;
  const card = e.target.closest('.page'); if(!card) return;
  if(e.target.closest('button')) return;
  cancelHold();
  tdrag = { card, id:e.pointerId, x0:e.clientX, y0:e.clientY, x:e.clientX, y:e.clientY, active:false, timer:0 };
  tdrag.timer = setTimeout(() => startTouchDrag(), HOLD_MS);
}, { passive:true });

function cancelHold(){ if(tdrag){ clearTimeout(tdrag.timer); if(!tdrag.active) tdrag = null; } }

function startTouchDrag(){
  if(!tdrag) return;
  const uid = tdrag.card.dataset.uid;
  const sel = selected();
  tdrag.uids = (sel.length > 1 && sel.some(p => p.uid === uid))
    ? pages.filter(p => sel.includes(p)).map(p => p.uid) : [uid];
  tdrag.active = true;
  buzz(18);
  document.body.classList.add('touch-dragging');
  tdrag.uids.forEach(u => { const p = pages.find(x => x.uid === u); if(p && p.el) p.el.classList.add('ghosting'); });

  const r = tdrag.card.getBoundingClientRect();
  const g = document.createElement('div');
  g.id = 'ghost';
  g.style.width = r.width + 'px';
  const src = tdrag.card.querySelector('canvas');
  if(src){
    const cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    cv.getContext('2d').drawImage(src, 0, 0);
    cv.style.width = '100%';
    g.appendChild(cv);
  }
  if(tdrag.uids.length > 1){
    const b = document.createElement('span');
    b.className = 'gcount'; b.textContent = tdrag.uids.length; g.appendChild(b);
  }
  document.body.appendChild(g);
  tdrag.ghost = g; tdrag.gw = r.width; tdrag.gh = g.offsetHeight;
  moveGhost(tdrag.x, tdrag.y);
}
function moveGhost(x, y){
  if(!tdrag || !tdrag.ghost) return;
  tdrag.ghost.style.transform =
    `translate(${x - tdrag.gw/2}px, ${y - tdrag.gh/2}px) rotate(-1.5deg)`;
}
document.addEventListener('pointermove', e => {
  if(!tdrag || e.pointerId !== tdrag.id) return;
  tdrag.x = e.clientX; tdrag.y = e.clientY;
  if(!tdrag.active){
    if(Math.hypot(e.clientX - tdrag.x0, e.clientY - tdrag.y0) > MOVE_TOL){ clearTimeout(tdrag.timer); tdrag = null; }
    return;
  }
  moveGhost(e.clientX, e.clientY);
  placeMarker(e.clientX, e.clientY);
  autoScroll(e.clientY);
}, { passive:true });

document.addEventListener('touchmove', e => {        // 드래그 중 스크롤 억제
  if(tdrag && tdrag.active && e.cancelable) e.preventDefault();
}, { passive:false });

function placeMarker(x, y){
  const el = document.elementFromPoint(x, y);
  const card = el && el.closest ? el.closest('.page') : null;
  if(card && !card.classList.contains('ghosting')){
    const r = card.getBoundingClientRect();
    (x < r.left + r.width/2) ? board.insertBefore(marker, card) : board.insertBefore(marker, card.nextSibling);
  }else if(!marker.parentNode){
    board.appendChild(marker);
  }
}
let scrollRaf = 0;
function autoScroll(y){
  const wrap = $('boardWrap'), r = wrap.getBoundingClientRect(), EDGE = 72;
  let dy = 0;
  if(y < r.top + EDGE) dy = -Math.ceil((r.top + EDGE - y) / 4);
  else if(y > r.bottom - EDGE) dy = Math.ceil((y - (r.bottom - EDGE)) / 4);
  cancelAnimationFrame(scrollRaf);
  if(dy) scrollRaf = requestAnimationFrame(() => {
    wrap.scrollTop += dy;
    if(tdrag && tdrag.active) autoScroll(tdrag.y);
    else if(typeof blankPointer!=='undefined'&&blankPointer?.active&&marker.parentNode===board){
      updateBlankMarker(blankPointer.clientX,blankPointer.clientY);autoScroll(blankPointer.clientY);
    }
  });
}
function endTouchDrag(){
  if(!tdrag) return;
  clearTimeout(tdrag.timer);
  if(!tdrag.active){ tdrag = null; return; }
  cancelAnimationFrame(scrollRaf);
  document.body.classList.remove('touch-dragging');
  if(tdrag.ghost) tdrag.ghost.remove();
  board.querySelectorAll('.ghosting').forEach(el => el.classList.remove('ghosting'));

  const set = new Set(tdrag.uids);
  let anchorUid = null, sib = marker.nextElementSibling;
  while(sib){ if(!set.has(sib.dataset.uid)){ anchorUid = sib.dataset.uid; break; } sib = sib.nextElementSibling; }
  const inBoard = marker.parentNode === board;
  marker.remove();
  const uids = tdrag.uids; tdrag = null;
  if(inBoard){ buzz(10); commitMove(uids, anchorUid); }
}
document.addEventListener('pointerup', e => { if(tdrag && e.pointerId === tdrag.id) endTouchDrag(); });
document.addEventListener('pointercancel', e => { if(tdrag && e.pointerId === tdrag.id) endTouchDrag(); });

/* ── 파일 드롭 ── */
['dragenter','dragover'].forEach(ev => document.addEventListener(ev, e => {
  if(dragUids.length || !e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
  e.preventDefault(); $('dropzone').classList.add('over');
}));
['dragleave','drop'].forEach(ev => document.addEventListener(ev, e => {
  if(e.type === 'dragleave' && e.relatedTarget) return;
  $('dropzone').classList.remove('over');
}));
document.addEventListener('drop', e => {
  if(dragUids.length || !e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault(); loadFiles(e.dataTransfer.files);
});

/* ── 전체화면 보기 ── */
async function preview(p){
  if(document.body.dataset.mode === 'pro'){ previewUid=p.uid;setLivePreviewOpen(true);return; }
  const pdf = docs.get(p.docId).pdfjsDoc;
  const page = await pdf.getPage(p.srcIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fit = Math.min((innerWidth - 60) / base.width, (innerHeight - 90) / base.height, 3);
  const vp = page.getViewport({ scale: fit * dpr, rotation: (base.rotation + p.rotation) % 360 });
  const c = $('modalCanvas');
  c.width = vp.width; c.height = vp.height;
  c.style.width = (vp.width / dpr) + 'px'; c.style.height = (vp.height / dpr) + 'px';
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  $('modal').classList.add('open');
}
$('modalClose').onclick = () => $('modal').classList.remove('open');
$('modal').onclick = e => { if(e.target.id === 'modal') $('modal').classList.remove('open'); };

/* ════════════════════════════════════════════════════════════
   저장 — 화면의 강조·사진을 PDF에 벡터/이미지로 실제로 굽는다
   ════════════════════════════════════════════════════════════ */
async function embedStamp(outDoc, st, cache){
  if(cache.has(st)) return cache.get(st);
  const emb = st.mime === 'image/jpeg' ? await outDoc.embedJpg(st.bytes) : await outDoc.embedPng(st.bytes);
  cache.set(st, emb);
  return emb;
}

async function bakeAnnots(outDoc, pg, p, imgCache){
  const pjPage = await docs.get(p.docId).pdfjsDoc.getPage(p.srcIndex + 1);
  const R = (pjPage.getViewport({ scale:1 }).rotation + p.rotation) % 360;
  const vp = pjPage.getViewport({ scale:1, rotation:R });   // 표시공간(회전 반영) 치수

  for(const a of p.annots){
    const dx = a.nx*vp.width, dy = a.ny*vp.height, dw = a.nw*vp.width, dh = a.nh*vp.height;
    const cs = [[dx,dy],[dx+dw,dy],[dx+dw,dy+dh],[dx,dy+dh]].map(([x,y]) => vp.convertToPdfPoint(x,y));
    const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
    const X = Math.min(...xs), Y = Math.min(...ys), W = Math.max(...xs)-X, H = Math.max(...ys)-Y;
    if(W < 1 || H < 1) continue;
    if(a.shape==='text'){await PDFMarkupText.bake(outDoc,pg,a,vp,R,imgCache);continue;}
    if(a.shape==='highlight'){
      const color=hexToRgb(a.fill||'#ffe082');
      pg.drawRectangle({x:X,y:Y,width:W,height:H,color:rgb(color.r,color.g,color.b),opacity:a.opacity,borderWidth:0,blendMode:PDFLib.BlendMode.Multiply});continue;
    }

    if(a.shape === 'image'){
      const st = stamps.get(a.stamp); if(!st) continue;
      const emb = await embedStamp(outDoc, st, imgCache);
      // 페이지 /Rotate가 나중에 적용되므로, 그 반대로 미리 돌려 화면과 같은 방향으로 보이게 한다
      let x = X, y = Y, w = W, h = H;
      if(R === 90){ w = H; h = W; x = X + W; y = Y; }
      else if(R === 180){ x = X + W; y = Y + H; }
      else if(R === 270){ w = H; h = W; x = X; y = Y + H; }
      pg.drawImage(emb, { x, y, width:w, height:h, rotate: degrees(R),
        opacity: a.opacity < 1 ? a.opacity : undefined });
      continue;
    }

    const s = hexToRgb(a.stroke), f = a.fill ? hexToRgb(a.fill) : null;
    const sColor = rgb(s.r,s.g,s.b), fColor = f ? rgb(f.r,f.g,f.b) : undefined;
    const dash = a.dash === 'dashed' ? [a.lineWidth*3, a.lineWidth*2] : undefined;
    const common = { borderColor:sColor, borderWidth:a.lineWidth, borderOpacity:1,
      color:fColor, opacity: f ? a.opacity : undefined, borderDashArray:dash };

    if(a.shape === 'ellipse'){
      pg.drawEllipse({ x:X+W/2, y:Y+H/2, xScale:W/2, yScale:H/2, ...common });
    }else if(a.shape === 'cloud'){
      const r = cloudRadius(W, H);
      const { start, segs } = cloudSamples(X, Y, W, H, r);
      const gs = outDoc.context.obj({ Type:'ExtGState', ca:(f ? a.opacity : 0), CA:1 });
      const gsName = pg.node.newExtGState('GSa'+(annoUidSeq++), outDoc.context.register(gs));
      const ops = [ pushGraphicsState(), setGraphicsState(gsName),
        setLineWidth(a.lineWidth), setStrokingColor(sColor) ];
      if(f) ops.push(setFillingColor(fColor));
      if(dash) ops.push(setDashPattern(dash, 0));
      ops.push(moveTo(start[0], start[1]));
      for(const g of segs) ops.push(appendBezierCurve(g.C1[0],g.C1[1], g.C2[0],g.C2[1], g.Q[0],g.Q[1]));
      ops.push(closePath(), f ? fillAndStroke() : opStroke(), popGraphicsState());
      pg.pushOperators(...ops);
    }else{
      pg.drawRectangle({ x:X, y:Y, width:W, height:H, ...common });
    }
  }
}

async function buildEditedDocument(list = pages){
  if(typeof textUpdate!=='undefined')await textUpdate;
  if(typeof finishTextEdit==='function'&&!finishTextEdit(true))throw new Error('텍스트 입력을 먼저 완료해 주세요.');
  const first = list.length && docs.get(list[0].docId);
  const complete = first && list.length === first.count && list.every((p,i)=>p.docId===list[0].docId && p.srcIndex===i);
  // Keep catalog-level forms/bookmarks when the complete source remains intact.
  const out = complete ? await PDFDocument.load(first.libBytes) : await PDFDocument.create();
  const imgCache = new Map(), copied = new Map();
  if(!complete){
    const need = new Map();
    for(const p of list){ if(!need.has(p.docId)) need.set(p.docId,[]); need.get(p.docId).push(p.srcIndex); }
    for(const [docId,indices] of need){
      const src = await PDFDocument.load(docs.get(docId).libBytes);
      copied.set(docId,await out.copyPages(src,indices));
      await idle();
    }
  }
  const cursor = new Map();
  for(let n=0;n<list.length;n++){
    const p=list[n], i=cursor.get(p.docId)||0;
    cursor.set(p.docId,i+1);
    const pg=complete ? out.getPage(n) : copied.get(p.docId)[i];
    if(p.rotation) pg.setRotation(degrees((pg.getRotation().angle+p.rotation)%360));
    if(p.annots?.length) await bakeAnnots(out,pg,p,imgCache);
    if(!complete) out.addPage(pg);
  }
  return out;
}

function downloadPdf(bytes,name){
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const a=document.createElement('a'); a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),8000);
}

async function save(){
  if(typeof textUpdate!=='undefined')await textUpdate;
  if(typeof finishTextEdit==='function'&&!finishTextEdit(true))return;
  if(!pages.length || document.body.classList.contains('is-busy')) return;
  if(document.body.dataset.mode==='pro' && typeof proPrimaryAction==='function') return proPrimaryAction();
  $('btnSave').disabled = true; $('mbSave').disabled = true;
  busy(true, 'PDF를 만드는 중…'); progress(12);
  await idle();
  try{
    const out = await buildEditedDocument();
    progress(88);
    const bytes = await out.save({ useObjectStreams:true, updateFieldAppearances:false });
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
    downloadPdf(bytes,`편집본_${stamp}.pdf`);
    toast(`${pages.length}페이지 PDF를 저장했습니다`);
  }catch(e){
    console.error(e);
    toast('PDF 생성에 실패했습니다 — 콘솔 로그를 확인하세요', true);
  }finally{
    busy(false); progress(0); syncCounts();
  }
}

/* ════════════════════════════════════════════════════════════
   툴바 · 단축키
   ════════════════════════════════════════════════════════════ */
function pickFiles(imagesOnly){
  const inp = $('fileInput');
  inp.accept = imagesOnly ? 'image/*' : 'application/pdf,.pdf,image/*';
  inp.click();
}
$('btnAdd').onclick = $('btnPick').onclick = $('mbAdd').onclick = () => pickFiles(false);
$('btnAddImg').onclick = $('btnPickImg').onclick = $('mbImg').onclick = () => pickFiles(true);
$('fileInput').onchange = e => { loadFiles(e.target.files); e.target.value = ''; };

const selectAll = () => { pages.forEach(p => p.el.classList.add('selected')); syncCounts(); };
const selectNone = () => { pages.forEach(p => p.el.classList.remove('selected')); lastClicked = null; syncCounts(); };
const toggleAll = () => selected().length === pages.length ? selectNone() : selectAll();
$('btnAll').onclick = $('mbAll').onclick = toggleAll;
$('mbNone').onclick = selectNone;
$('btnDel').onclick = $('mbDel').onclick = () => remove(selected());
$('btnBlank').onclick = $('mbBlank').onclick = () => {if(typeof blankDragClickBlocked!=='function'||!blankDragClickBlocked())insertBlankPage();};
$('btnRotL').onclick = $('mbRotL').onclick = () => rotate(selected(), -90);
$('btnRotR').onclick = $('mbRotR').onclick = () => rotate(selected(), 90);
$('btnSave').onclick = $('mbSave').onclick = save;
$('btnReset').onclick = () => {
  if(!confirm('불러온 문서와 편집 내용을 모두 지웁니다. 계속할까요?')) return;
  stamps.forEach(s => URL.revokeObjectURL(s.url)); stamps.clear();
  clearPreview();
  for(const d of docs.values())void d.pdfjsDoc?.destroy().catch(()=>{});
  docs.clear(); pages = []; origCount = 0; docSeq = 0; lastClicked = null;
  if(typeof resetTools==='function')resetTools();
  clearPreview(); render();
};

/* 열 수 (2~6) */
const COLS_MIN = 2, COLS_MAX = 6;
let colCount = 4;
function applyCols(n){
  colCount = clamp(n, COLS_MIN, COLS_MAX);
  board.style.setProperty('--cols', colCount);
  $('colsVal').textContent = colCount;
  $('colsRange').value = colCount;
}
$('colsRange').oninput = e => applyCols(+e.target.value);
applyCols(4);

$('boardWrap').addEventListener('wheel', e => {
  if(!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  applyCols(colCount + (e.deltaY > 0 ? 1 : -1));
}, { passive:false });

$('pvExpand').onclick = () => { const p = pages.find(x => x.uid === previewUid); if(p) preview(p); };
$('pvZoomIn').onclick = () => setZoom(pvZoom * 1.25);
$('pvZoomOut').onclick = () => setZoom(pvZoom / 1.25);
$('pvZoomVal').onclick = () => setZoom(1);
$('pvBody').addEventListener('wheel', e => {
  if(!(e.ctrlKey || e.metaKey) || !previewUid) return;
  e.preventDefault();
  setZoom(pvZoom * (e.deltaY > 0 ? 0.9 : 1.1));
}, { passive:false });

/* 미리보기 핀치 줌 — 손가락을 뗄 때 한 번만 다시 그린다 */
(() => {
  const body = $('pvBody'), stage = $('pvStage');
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  body.addEventListener('touchstart', e => {
    if(e.touches.length !== 2 || !previewUid || $('pvStage').hidden) return;
    drag = null;
    pinch = { d0: Math.max(1, dist(e.touches)), z0: pvZoom, k: 1 };
    stage.style.transformOrigin = 'center center';
  }, { passive:true });
  body.addEventListener('touchmove', e => {
    if(!pinch || e.touches.length !== 2) return;
    if(e.cancelable) e.preventDefault();
    pinch.k = clamp(dist(e.touches) / pinch.d0, 0.25, 4);
    stage.style.transform = 'scale(' + pinch.k + ')';
  }, { passive:false });
  const done = () => {
    if(!pinch) return;
    const z = pinch.z0 * pinch.k; pinch = null;
    stage.style.transform = '';
    setZoom(z);
  };
  body.addEventListener('touchend', done);
  body.addEventListener('touchcancel', done);
})();

/* 문서 정보 */
$('drawerTab').onclick = () => $('drawer').classList.toggle('open');
$('btnInfo').onclick = () => { renderInfo(); $('sheet').classList.add('open'); };
$('sheetScrim').onclick = () => $('sheet').classList.remove('open');

function syncAnnotationControls(){
  const a=curAnnots().find(x=>x.id===selAnno);
  const shape=annoStyle.tool==='none'?a?.shape:annoStyle.tool;
  const imageSelected=shape==='image';
  $('annoProperties').hidden=!shape||imageSelected||shape==='text';
  $('annoStrokeGroup').hidden=shape==='highlight';
  $('annoNoFill').hidden=shape==='highlight';
  $('annoImageHint').hidden=!imageSelected;
  $('annoStroke').value=annoStyle.stroke;
  if(annoStyle.fill) $('annoFill').value=annoStyle.fill;
  $('annoNoFill').classList.toggle('on',!annoStyle.fill);
  $('annoNoFill').setAttribute('aria-pressed',String(!annoStyle.fill));
  $('fillSwatch').classList.toggle('off',!annoStyle.fill);
  $('annoWidth').value=annoStyle.lineWidth;
  $('annoOpacity').value=Math.round(annoStyle.opacity*100);
  $('annoOpacity').disabled=!annoStyle.fill;
  $('annoOpacityVal').textContent=Math.round(annoStyle.opacity*100)+'%';
  document.querySelectorAll('.ab-dbtn').forEach(b=>b.classList.toggle('active',b.dataset.dash===annoStyle.dash));
  document.querySelectorAll('.ab-tool').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===annoStyle.tool)));
  if(typeof syncTextControls==='function')syncTextControls();
}
/* 강조 툴바 */
function setTool(t){
  if(typeof finishTextEdit==='function'&&t!=='none'&&!finishTextEdit(true))return;
  annoStyle.tool = t;
  if(t==='highlight'){annoStyle.fill||='#ffe082';annoStyle.opacity=.35;}
  if(t!=='none')selAnno=null;
  if(t !== 'image') pendingStamp = null;
  document.querySelectorAll('.ab-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  $('pvOverlay').classList.toggle('draw', t !== 'none');
  syncAnnotationControls();
}
document.querySelectorAll('.ab-tool').forEach(b => b.onclick = () => {
  const t = b.dataset.tool;
  if(t === 'image'){ setTool('image'); openStampPicker(); return; }
  setTool(t);
});
document.querySelectorAll('.ab-dbtn').forEach(b => b.onclick = () => {
  annoStyle.dash = b.dataset.dash;
  document.querySelectorAll('.ab-dbtn').forEach(x => x.classList.toggle('active', x === b));
  applyStyleToSelected();
});
$('annoStroke').oninput = e => { annoStyle.stroke = e.target.value; applyStyleToSelected(); };
$('annoFill').oninput = e => {
  annoStyle.fill = e.target.value;
  $('annoNoFill').classList.remove('on'); $('fillSwatch').classList.remove('off');
  applyStyleToSelected();
};
$('annoNoFill').onclick = () => {
  const off = !$('annoNoFill').classList.contains('on');
  $('annoNoFill').classList.toggle('on', off);
  $('fillSwatch').classList.toggle('off', off);
  annoStyle.fill = off ? null : $('annoFill').value;
  applyStyleToSelected();
};
$('annoWidth').oninput = e => { annoStyle.lineWidth = clamp(+e.target.value || 2, 0.5, 12); applyStyleToSelected(); };
$('annoOpacity').oninput = e => {
  annoStyle.opacity = (+e.target.value) / 100;
  $('annoOpacityVal').textContent = e.target.value + '%';
  applyStyleToSelected();
};
function applyStyleToSelected(){
  syncAnnotationControls();
  if(!selAnno) return;
  const a = curAnnots().find(x => x.id === selAnno); if(!a) return;
  if(a.shape === 'image'||a.shape==='text') return;
  a.stroke = a.shape==='highlight'?'none':annoStyle.stroke; a.fill = annoStyle.fill; a.lineWidth = a.shape==='highlight'?0:annoStyle.lineWidth;
  a.dash = annoStyle.dash; a.opacity = annoStyle.opacity;
  renderAnnots();
}
$('annoDel').onclick = () => {
  if(!selAnno) return;
  if(typeof textEditing!=='undefined'&&textEditing){const id=selAnno;finishTextEdit(false);selAnno=id;}
  const arr = curAnnots(); const i = arr.findIndex(x => x.id === selAnno);
  if(i >= 0) arr.splice(i, 1);
  selAnno = null; renderAnnots(); syncCounts();
};
$('annoClear').onclick = () => {
  const arr = curAnnots(); if(!arr.length) return;
  if(!confirm('이 페이지의 마크업을 모두 지울까요?')) return;
  if(typeof finishTextEdit==='function')finishTextEdit(false);
  arr.length = 0; selAnno = null; renderAnnots(); syncCounts();
};

/* ════════════════════════════════════════════════════════════
   레이아웃 — 데스크톱 분할 / 모바일 전환
   ════════════════════════════════════════════════════════════ */
const mainEl = document.querySelector('main');
const LAYOUT_COL_BREAK = 1180;
const MOBILE_BREAK = 880;
let curLayout = '', previewOn = true, userToggled = false, mobileView = 'board';

const isMobile = () => window.innerWidth <= MOBILE_BREAK;

function setMobileView(v){
  mobileView = v;
  mainEl.classList.toggle('view-board', v === 'board');
  mainEl.classList.toggle('view-preview', v === 'preview');
  $('segBoard').classList.toggle('on', v === 'board');
  $('segPreview').classList.toggle('on', v === 'preview');
  if(v === 'preview'){
    const p = pages.find(x => x.uid === previewUid) || pages[0];
    if(p) showPreview(p);
  }
}
$('segBoard').onclick = () => setMobileView('board');
$('segPreview').onclick = () => setMobileView('preview');

function applyLayout(){
  const w = window.innerWidth;
  const want = isMobile() ? 'mobile' : (w <= LAYOUT_COL_BREAK ? 'col' : 'row');
  board.style.setProperty('--mcols', w <= 620 ? 2 : 3);
  if(want === curLayout){ return; }
  $('previewPanel').style.flexBasis = '';
  mainEl.classList.toggle('layout-mobile', want === 'mobile');
  mainEl.classList.toggle('layout-col', want === 'col');
  mainEl.classList.toggle('layout-row', want === 'row');
  curLayout = want;
  if(want === 'mobile'){
    setMobileView(mobileView);
  }else{
    if(!userToggled) previewOn = true;
    syncPreviewVisible();
  }
  const p = pages.find(x => x.uid === previewUid);
  if(p) showPreview(p);
}
function syncPreviewVisible(){
  mainEl.classList.toggle('preview-off', !previewOn && curLayout !== 'mobile');
  $('btnPreview').classList.toggle('active', previewOn);
}
$('btnPreview').onclick = () => {
  previewOn = !previewOn; userToggled = true;
  syncPreviewVisible();
  if(previewOn){ const p = pages.find(x => x.uid === previewUid); if(p) showPreview(p); }
};

let resizeT = 0;
window.addEventListener('resize', () => {
  applyLayout(); measureActionBar();
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { const p = pages.find(x => x.uid === previewUid); if(p) showPreview(p); }, 220);
});

/* 분할 divider 드래그 */
(() => {
  const div = $('divider'), panel = $('previewPanel');
  let dragging = false;
  const onMove = e => {
    if(!dragging) return;
    const r = mainEl.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    if(curLayout === 'row'){
      panel.style.flexBasis = clamp(r.right - cx - 4, 280, r.width - 340) + 'px';
    }else if(curLayout === 'col'){
      panel.style.flexBasis = clamp(r.bottom - cy - 4, 180, r.height - 220) + 'px';
    }
  };
  const stop = () => {
    if(!dragging) return;
    dragging = false; div.classList.remove('active');
    document.body.classList.remove('resizing','rz-col','rz-row');
    const p = pages.find(x => x.uid === previewUid); if(p) showPreview(p);
  };
  const start = e => {
    dragging = true; div.classList.add('active');
    document.body.classList.add('resizing', curLayout === 'row' ? 'rz-col' : 'rz-row');
    if(e.cancelable) e.preventDefault();
  };
  div.addEventListener('mousedown', start);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', stop);
  div.addEventListener('touchstart', start, { passive:false });
  document.addEventListener('touchmove', onMove, { passive:true });
  document.addEventListener('touchend', stop);
  div.addEventListener('dblclick', () => {
    panel.style.flexBasis = '';
    const p = pages.find(x => x.uid === previewUid); if(p) showPreview(p);
  });
})();

/* ── 테마 (자동 / 밝게 / 어둡게) ── */
const THEMES = ['light','dark','auto'];
const THEME_ICON = { auto:'#i-auto', light:'#i-sun', dark:'#i-moon' };
const THEME_NAME = { auto:'시스템 설정을 따름', light:'밝은 화면', dark:'어두운 화면' };
let theme = 'light';
function applyTheme(t, announce){
  theme = t;
  const resolved=t==='auto' ? (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light') : t;
  document.documentElement.setAttribute('data-theme', resolved);
  document.querySelector('meta[name=theme-color]').content=resolved==='dark'?'#202124':'#f4f5f5';
  $('themeIcon').firstElementChild.setAttribute('href', THEME_ICON[t]);
  $('btnTheme').title = '화면 테마 — ' + THEME_NAME[t];
  try{ localStorage.setItem('pdfed-theme-v2', t); }catch(_){}
  if(announce) toast(THEME_NAME[t]);
  const p = pages.find(x => x.uid === previewUid); if(p) showPreview(p);
}
try{ const saved = localStorage.getItem('pdfed-theme-v2'); if(THEMES.includes(saved)) theme = saved; }catch(_){}
$('btnTheme').onclick = () => applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length], true);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(theme==='auto')applyTheme('auto',false);});

/* ── 단축키 ── */
document.addEventListener('keydown', e => {
  if(document.querySelector('dialog[open]'))return;
  if(document.body.classList.contains('is-busy')){ if(e.key==='Escape' && !$('busyCancel').hidden) $('busyCancel').click(); e.preventDefault(); return; }
  if($('proCompare')?.open) return;
  if($('modal').classList.contains('open') && e.key === 'Escape'){ $('modal').classList.remove('open'); return; }
  if($('sheet').classList.contains('open') && e.key === 'Escape'){ $('sheet').classList.remove('open'); return; }
  if(e.target.matches('input,textarea,select')) return;
  if(e.key === 'Escape' && annoStyle.tool !== 'none'){ setTool('none'); return; }
  if(e.key === 'Delete' || e.key === 'Backspace'){
    if(selAnno){ e.preventDefault(); $('annoDel').click(); return; }
    if(selected().length){ e.preventDefault(); remove(selected()); }
  }
  if((e.ctrlKey || e.metaKey) && e.key === 'a' && pages.length && !selAnno){ e.preventDefault(); selectAll(); }
  if((e.ctrlKey || e.metaKey) && e.key === 's'){ e.preventDefault(); save(); }
});

/* ── 기동 ── */
applyTheme(theme, false);
applyLayout();
render();
console.log('PDF 페이지 편집기 — 오프라인 모드 준비 완료 (워커: %s)',
  globalThis.pdfjsWorker ? '메인스레드 내장' : '미검출');
