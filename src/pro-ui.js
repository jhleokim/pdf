'use strict';
let proMode='basic', proResult=null, proAbort=null;
let proReady=false;
const proPresets={quality:{resolution:3200,quality:92},balanced:{resolution:2400,quality:82},small:{resolution:1600,quality:65}};
const proControlIds=['proOptimize','proPreset','proResolution','proQuality','proGrayscale','proContrast','proWhitePoint','proCrop','proCropTop','proCropRight','proCropBottom','proCropLeft','proPaper','proNumber','proStartNumber','proSkipPages','proNumberPosition','proWatermark'];
const formatBytes=n=> n>=1048576 ? (n/1048576).toFixed(2)+' MB' : (n/1024).toFixed(1)+' KB';
function proFingerprint(){return JSON.stringify(pages.map(p=>[p.uid,p.docId,p.srcIndex,p.rotation,p.annots||[]]));}
function proInvalidate(message){
  if(!proResult) return;
  proResult=null; $('proResult').hidden=true;
  if(message) $('proStatus').textContent=message;
}
function syncProState(){
  if(!proReady) return;
  const any=pages.length>0, working=!!proAbort;
  $('proOpen').hidden=any;
  $('proExport').disabled=!any||working; $('proPreview').disabled=!any||working;
  if(proResult && proResult.fingerprint!==proFingerprint()) proInvalidate('편집 내용이 바뀌었습니다. 결과를 다시 만들어 주세요.');
  syncLivePreview();
  if(!any) $('proStatus').textContent='파일을 추가하면 시작할 수 있어요.';
  else if(!working && !proResult) $('proStatus').textContent=`${pages.length}페이지 · 설정 변경은 미리보기에 자동 반영됩니다.`;
}
function setProView(view){
  document.body.dataset.proView=view;
  $('proWorkspace').setAttribute('aria-pressed',String(view==='workspace'));
  $('proSettings').setAttribute('aria-pressed',String(view==='settings'));
  measureActionBar();
  requestAnimationFrame(()=>{const p=pages.find(p=>p.uid===previewUid);if(p)showPreview(p);});
}
function setProMode(mode){
  proMode=mode; document.body.dataset.mode=mode;
  $('modeBasic').setAttribute('aria-pressed',String(mode==='basic'));
  $('modePro').setAttribute('aria-pressed',String(mode==='pro'));
  $('proPanel').hidden=mode!=='pro'; $('proMobileSwitch').hidden=mode!=='pro';
  $('btnSave').querySelector('span').textContent=mode==='pro'?'Pro 결과 만들기':'PDF로 저장';
  $('btnSave').title=mode==='pro'?'현재 Pro 설정으로 결과를 만듭니다':'Basic 편집본을 저장합니다';
  if(mode==='pro' && isMobile()) setProView('settings'); else setProView('workspace');
  // Only a UI preference is stored. Documents and result bytes stay in memory.
  try{localStorage.setItem('pdfed-mode',mode);}catch(_){}
  if(mode==='basic'){syncPreviewVisible();$('btnPreview').title='미리보기 표시 / 숨기기';}
  syncProState();
}
function proNumberInput(id,min,max,integer=false){
  const el=$(id), n=Number(el.value);
  if(el.value.trim()===''||!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n))){
    el.focus();throw new Error(`${el.labels?.[0]?.textContent.trim()||'설정'}: ${min}~${max} 범위의 ${integer?'정수':'숫자'}를 입력하세요.`);
  }
  return n;
}
function readProOptions(){
  const crop=$('proCrop').checked, number=$('proNumber').checked;
  return {
    optimize:$('proOptimize').checked,maxDimension:Number($('proResolution').value),jpegQuality:Number($('proQuality').value)/100,
    grayscale:$('proGrayscale').checked,contrast:Number($('proContrast').value),whitePoint:Number($('proWhitePoint').value),
    crop,margins:crop ? ['Top','Right','Bottom','Left'].map(s=>proNumberInput('proCrop'+s,0,100)) : [0,0,0,0],
    paper:$('proPaper').value,number,startNumber:number?proNumberInput('proStartNumber',1,999999,true):1,
    skipPages:number?proNumberInput('proSkipPages',0,99999,true):0,
    numberPosition:$('proNumberPosition').value,watermark:$('proWatermark').value.trim().slice(0,40)
  };
}
function refreshProControls(){
  $('proQualityValue').value=$('proQuality').value+'%';
  $('proContrastValue').value=$('proContrast').value;
  $('proWhitePointValue').value=$('proWhitePoint').value;
  ['proPreset','proResolution','proQuality'].forEach(id=>$(id).disabled=!$('proOptimize').checked);
  ['Top','Right','Bottom','Left'].forEach(s=>$('proCrop'+s).disabled=!$('proCrop').checked);
  ['proStartNumber','proSkipPages','proNumberPosition'].forEach(id=>$(id).disabled=!$('proNumber').checked);
}
function resetProOptions(){
  for(const id of proControlIds){const e=$(id);if(e.type==='checkbox')e.checked=e.defaultChecked;else if(e.tagName==='SELECT')e.value=[...e.options].find(o=>o.defaultSelected)?.value||e.options[0].value;else e.value=e.defaultValue;}
  refreshProControls();proInvalidate();syncProState();scheduleLivePreview();toast('Pro 설정을 초기화했습니다');
}
function checkProAbort(){if(proAbort?.signal.aborted)throw new DOMException('취소했습니다.','AbortError');}
function startProWork(label){
  cancelLivePreview();
  proAbort=new AbortController();$('busyCancel').hidden=false;$('busyCancel').disabled=false;
  busy(true,label);syncProState();
}
function finishProWork(){proAbort=null;$('busyCancel').hidden=true;busy(false);progress(0);syncProState();}
async function processProDoc(doc,options,pageOffset){
  const signal=proAbort.signal;
  checkProAbort();
  const report=await PDFPro.processDocument(doc,options,{signal,onProgress:info=>{
    const fraction=typeof info==='number'?info:(info?.total ? info.completed/info.total : 1);
    progress(20+fraction*45);
    busy(true,'이미지를 최적화하고 보정하는 중…');
  }});
  checkProAbort();busy(true,'페이지 설정을 적용하는 중…');
  await PDFProDocument.applyDocument(doc,options,{pageOffset,signal,onProgress:n=>progress(65+n*15)});
  checkProAbort();return report;
}
async function verifyProText(before,after,signal,quiet=false){
  let a,b;
  try{
    a=await pdfjsLib.getDocument({data:before.slice(),...DOC_OPTS}).promise;
    b=await pdfjsLib.getDocument({data:after.slice(),...DOC_OPTS}).promise;
    if(a.numPages!==b.numPages)throw new Error('결과의 페이지 수가 달라졌습니다.');
    let characters=0, checked=0;
    for(let i=1;i<=a.numPages;i++){
      if(signal?.aborted)throw new DOMException('취소했습니다.','AbortError');
      const [ap,bp]=await Promise.all([a.getPage(i),b.getPage(i)]);
      const [at,bt]=await Promise.all([ap.getTextContent(),bp.getTextContent()]);
      // Include invisible OCR; an added page number may append text.
      const original=at.items.map(x=>x.str||'').join('').replace(/\s/g,'');
      const result=bt.items.map(x=>x.str||'').join('').replace(/\s/g,'');
      if(original && !result.includes(original))throw new Error(`${i}페이지의 기존 텍스트 보존을 확인하지 못했습니다. 페이지 재단을 줄이거나 원래 크기로 다시 시도해 주세요.`);
      characters+=original.length;checked++;
      if(!quiet){busy(true,`기존 텍스트 확인 중… ${i}/${a.numPages}`);progress(80+i/a.numPages*18);}
      await idle();
    }
    return {characters,checked};
  }finally{await Promise.allSettled([a?.destroy(),b?.destroy()]);}
}
function proSummary(report,textCheck){
  const lines=[`이미지 ${report.changed}개 변경 · ${report.skipped}개 원본 유지`];
  if(textCheck.characters)lines.push(`기존 텍스트 ${textCheck.characters.toLocaleString()}자 보존 확인`);
  else lines.push('원래 검색 가능한 텍스트가 없는 문서입니다.');
  if(report.notes?.length)lines.push(...report.notes);
  return lines.join('\n');
}
async function createProResult(){
  if(!pages.length||document.body.classList.contains('is-busy'))return;
  let options;try{options=readProOptions();}catch(e){toast(e.message,true);return;}
  proInvalidate();startProWork('편집본을 준비하는 중…');await idle();
  try{
    const fingerprint=proFingerprint();
    const edited=await buildEditedDocument();checkProAbort();
    const before=await edited.save({useObjectStreams:true,updateFieldAppearances:false});
    // Reload the baseline so new marks cannot reuse cached, already-saved
    // content streams created while baking the user's Basic annotations.
    const doc=await PDFLib.PDFDocument.load(before);checkProAbort();
    const report=await processProDoc(doc,options,0);
    const bytes=await doc.save({useObjectStreams:true,updateFieldAppearances:false});checkProAbort();
    const textCheck=await verifyProText(before,bytes,proAbort.signal);checkProAbort();
    proResult={bytes,fingerprint};
    $('proBeforeSize').textContent=formatBytes(before.length);$('proAfterSize').textContent=formatBytes(bytes.length);
    const change=(1-bytes.length/before.length)*100;
    $('proReduction').textContent=Math.abs(change)<.1 ? '용량 변화가 거의 없습니다.' : change>0 ? `${change.toFixed(1)}% 줄어들었어요` : `${(-change).toFixed(1)}% 증가 · 보정·페이지 설정이 반영됐어요`;
    $('proReport').textContent=proSummary(report,textCheck);$('proResult').hidden=false;
    $('proStatus').textContent='결과를 확인하고 다운로드하세요.';
    $('proResult').scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(e){
    if(e.name==='AbortError')toast('작업을 취소했습니다. 편집 중인 문서는 유지됩니다.');
    else{console.error(e);toast(e.message||'Pro 결과를 만들지 못했습니다.',true);$('proStatus').textContent=e.message;}
  }finally{finishProWork();}
}
$('modeBasic').onclick=()=>setProMode('basic');$('modePro').onclick=()=>setProMode('pro');
$('proWorkspace').onclick=()=>setProView('workspace');$('proSettings').onclick=()=>setProView('settings');
$('proOpen').onclick=()=>pickFiles(false);
$('proPreset').onchange=()=>{const p=proPresets[$('proPreset').value];$('proResolution').value=p.resolution;$('proQuality').value=p.quality;refreshProControls();proInvalidate();scheduleLivePreview();};
for(const id of proControlIds)$(id).addEventListener('input',()=>{refreshProControls();proInvalidate('설정이 바뀌었습니다. 결과를 다시 만들어 주세요.');scheduleLivePreview();});
$('proReset').onclick=resetProOptions;$('proExport').onclick=createProResult;$('proPreview').onclick=()=>setLivePreviewOpen(!proPreviewOpen);
$('proDownload').onclick=()=>{
  if(!proResult)return;
  if(proResult.fingerprint!==proFingerprint()){proInvalidate();syncProState();toast('편집 내용이 바뀌었습니다. 결과를 다시 만들어 주세요.',true);return;}
  const name=($('proFilename').value.trim().replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'')||'편집본').slice(0,100);
  downloadPdf(proResult.bytes,name+'.pdf');toast('Pro 결과 PDF를 저장했습니다');
};
$('proDiscard').onclick=()=>{proInvalidate();syncProState();};
$('busyCancel').onclick=()=>{proAbort?.abort();$('busyCancel').disabled=true;$('busyText').textContent='작업을 취소하는 중…';};
proReady=true;refreshProControls();
let savedProMode='basic';try{if(localStorage.getItem('pdfed-mode')==='pro')savedProMode='pro';}catch(_){}
setProMode(savedProMode);
