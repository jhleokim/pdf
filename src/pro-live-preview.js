'use strict';
// Serial jobs and a generation token keep stale processing off the screen.
let proPreviewOpen=true, liveTimer, liveController=null, liveSequence=0;
let liveQueue=Promise.resolve(), liveRequestedKey='', liveDocs=[], liveHadPages=false;
let originalHover=false, originalPinned=false;
const livePage=()=>pages.find(p=>p.uid===previewUid)||selected()[0]||pages[0];
function liveKey(){
  return JSON.stringify([proFingerprint(),livePage()?.uid,proControlIds.map(id=>{
    const el=$(id);return el.type==='checkbox'?el.checked:el.value;
  }),$('compareZoom').value,$('compareStage').clientWidth,$('compareStage').clientHeight]);
}
function cancelLivePreview(){
  clearTimeout(liveTimer);liveSequence++;liveController?.abort();liveRequestedKey='';
}
function showOriginal(){
  const show=!$('compareOriginal').disabled&&(originalHover||originalPinned);
  $('compareStage').classList.toggle('show-original',show);
  $('compareOriginal').setAttribute('aria-pressed',String(show));
  $('compareBeforeScroll').setAttribute('aria-hidden',String(!show));
  $('compareAfterScroll').setAttribute('aria-hidden',String(show));
}
function setLivePreviewOpen(open){
  proPreviewOpen=open;
  syncLivePreview();
}
function syncLivePreview(){
  if(!proReady)return;
  const any=pages.length>0;
  if(any&&!liveHadPages)proPreviewOpen=true;
  liveHadPages=any;
  const visible=proMode==='pro'&&any&&proPreviewOpen;
  $('proCompare').hidden=!visible;
  document.body.classList.toggle('pro-preview-open',visible);
  $('proPreview').setAttribute('aria-pressed',String(visible));
  $('proPreviewLabel').textContent=visible?'미리보기 닫기':'페이지 미리보기';
  if(proMode==='pro'){
    $('btnPreview').setAttribute('aria-pressed',String(visible));
    $('btnPreview').title=visible?'미리보기 닫기':'페이지 미리보기';
    $('btnPreview').classList.toggle('active',visible);
  }
  if(!visible||proAbort){cancelLivePreview();return;}
  const index=pages.indexOf(livePage());
  $('comparePrev').disabled=index<=0;$('compareNext').disabled=index>=pages.length-1;
  if(liveKey()!==liveRequestedKey)scheduleLivePreview();
}
function scheduleLivePreview(){
  if(!proReady||proMode!=='pro'||!pages.length||!proPreviewOpen||proAbort)return;
  cancelLivePreview();liveRequestedKey=liveKey();
  const seq=liveSequence;
  $('compareState').textContent='변경 사항 반영 중…';
  $('proCompare').setAttribute('aria-busy','true');
  $('compareOriginal').disabled=true;originalHover=originalPinned=false;showOriginal();
  liveTimer=setTimeout(()=>{liveQueue=liveQueue.catch(()=>{}).then(()=>updateLivePreview(seq));},300);
}
async function liveCanvas(pdf,factor){
  const page=await pdf.getPage(1),base=page.getViewport({scale:1}),slot=$('compareAfterScroll');
  const fit=Math.max(.05,Math.min((slot.clientWidth-40)/base.width,(slot.clientHeight-40)/base.height));
  const scale=Math.min(8,fit*factor),dpr=Math.min(devicePixelRatio||1,2);
  const vp=page.getViewport({scale:scale*dpr}),canvas=document.createElement('canvas');
  canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
  canvas.style.width=base.width*scale+'px';canvas.style.height=base.height*scale+'px';
  await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  return canvas;
}
async function updateLivePreview(seq){
  if(seq!==liveSequence)return;
  const controller=new AbortController();liveController=controller;
  const signal=controller.signal,check=()=>{
    if(signal.aborted||seq!==liveSequence)throw new DOMException('Superseded','AbortError');
  };
  let loaded=[];
  try{
    const p=livePage(),offset=pages.indexOf(p),options=readProOptions();
    const edited=await buildEditedDocument([p]);check();
    const before=await edited.save({useObjectStreams:true,updateFieldAppearances:false});check();
    const doc=await PDFLib.PDFDocument.load(before);check();
    const deskew=await PDFDeskew.processDocument(doc,options,{signal,docOptions:DOC_OPTS,pageOffset:offset});check();
    const report=await PDFPro.processDocument(doc,options,{signal});check();
    await PDFProDocument.applyDocument(doc,options,{pageOffset:offset,signal});check();
    const after=await doc.save({useObjectStreams:true,updateFieldAppearances:false});check();
    await verifyProText(before,after,signal,true);check();
    for(const data of [before,after]){loaded.push(await pdfjsLib.getDocument({data,...DOC_OPTS}).promise);check();}
    const canvases=[];
    for(const pdf of loaded){canvases.push(await liveCanvas(pdf,Number($('compareZoom').value)));check();}
    // Publish both detached canvases together, after all cancellation checks.
    for(let i=0;i<2;i++){
      const id=i?'compareAfter':'compareBefore',old=$(id),canvas=canvases[i];
      canvas.id=id;canvas.setAttribute('aria-label',old.getAttribute('aria-label'));old.replaceWith(canvas);
    }
    const old=liveDocs;liveDocs=loaded;loaded=[];
    await Promise.allSettled(old.map(d=>d.destroy()));check();
    $('comparePageLabel').textContent=`${offset+1} / ${pages.length}페이지`;
    $('compareState').textContent='미리보기 업데이트 완료';
    $('compareOriginal').disabled=false;
    let note='원본 보기에 마우스를 올려 비교하세요. 터치·키보드에서는 눌러 전환합니다.';
    if(options.grayscale&&report.changed===0)note=report.imageCount===0?'이 페이지에는 보정할 이미지가 없습니다. 텍스트와 벡터 색상은 유지됩니다.':'변환 가능한 이미지가 없어 원본을 유지했습니다. '+report.notes.join(' ');
    else if(report.skipped)note=`이미지 ${report.changed}개 반영 · ${report.skipped}개 원본 유지. `+report.notes.join(' ');
    $('compareApplied').textContent=describeProSettings(options,report,deskew,offset);
    $('compareNote').textContent=note;$('proCompare').removeAttribute('data-error');
  }catch(e){
    if(e.name!=='AbortError'&&seq===liveSequence){
      $('compareState').textContent='미리보기를 업데이트하지 못했습니다';
      $('compareNote').textContent=e.message;$('proCompare').setAttribute('data-error','true');
    }
  }finally{
    await Promise.allSettled(loaded.map(d=>d.destroy()));
    if(liveController===controller)liveController=null;
    if(seq===liveSequence)$('proCompare').setAttribute('aria-busy','false');
  }
}
$('compareClose').onclick=()=>{setLivePreviewOpen(false);(isMobile()?$('proWorkspace'):$('btnPreview')).focus();};
$('comparePrev').onclick=()=>{const p=pages[pages.indexOf(livePage())-1];if(p)showPreview(p);};
$('compareNext').onclick=()=>{const p=pages[pages.indexOf(livePage())+1];if(p)showPreview(p);};
$('compareZoom').onchange=scheduleLivePreview;
$('compareOriginal').addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){originalHover=true;showOriginal();}});
$('compareOriginal').addEventListener('pointerleave',()=>{originalHover=false;showOriginal();});
$('compareOriginal').onclick=()=>{originalPinned=!originalPinned;showOriginal();};
$('compareOriginal').addEventListener('blur',()=>{originalPinned=false;showOriginal();});
let liveScrollSync=false;
for(const [a,b] of [['compareBeforeScroll','compareAfterScroll'],['compareAfterScroll','compareBeforeScroll']])$(a).addEventListener('scroll',()=>{
  if(liveScrollSync)return;liveScrollSync=true;
  const x=$(a),y=$(b);y.scrollTop=x.scrollTop/Math.max(1,x.scrollHeight-x.clientHeight)*Math.max(0,y.scrollHeight-y.clientHeight);y.scrollLeft=x.scrollLeft/Math.max(1,x.scrollWidth-x.clientWidth)*Math.max(0,y.scrollWidth-y.clientWidth);
  requestAnimationFrame(()=>liveScrollSync=false);
});
const basicPreviewToggle=$('btnPreview').onclick;
$('btnPreview').onclick=()=>proMode==='pro'?setLivePreviewOpen(!proPreviewOpen):basicPreviewToggle();
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&proMode==='pro'&&proPreviewOpen&&!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))setLivePreviewOpen(false);
});
new ResizeObserver(()=>{if(typeof proReady!=='undefined'&&proReady)syncLivePreview();}).observe($('compareStage'));
