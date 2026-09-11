'use strict';
let proMode='basic', proResult=null, proAbort=null;
let proReady=false;
const proPresets={quality:{resolution:3200,quality:92},balanced:{resolution:2400,quality:82},small:{resolution:1200,quality:50}};
const proControlIds=['proOptimize','proCompressionMode','proBWThreshold','proPreset','proResolution','proQuality','proGrayscale','proContrast','proWhitePoint','proDeskew','proCrop','proCropTop','proCropRight','proCropBottom','proCropLeft','proPaper','proNumber','proStartNumber','proSkipPages','proNumberPosition','proWatermark'];
const formatBytes=n=> n>=1048576 ? (n/1048576).toFixed(2)+' MB' : (n/1024).toFixed(1)+' KB';
function proFingerprint(){return JSON.stringify(pages.map(p=>[p.uid,p.docId,p.srcIndex,p.rotation,p.annots||[]]));}
function proInvalidate(message){
  if(!proResult) return;
  proResult=null; $('proResult').hidden=true;
  syncProAction();
  if(message) $('proStatus').textContent=message;
}
function syncProAction(){
  const ready=!!proResult;
  $('proExportLabel').textContent=ready?'PDF 다운로드':'결과 만들기';
  if(proMode==='pro'){
    $('btnSave').querySelector('span').textContent=ready?'PDF 다운로드':'Pro 결과 만들기';
    $('btnSave').title=ready?'완성된 PDF를 다운로드합니다':'현재 Pro 설정으로 결과를 만듭니다';
  }
}
function syncProState(){
  if(!proReady) return;
  const any=pages.length>0, working=!!proAbort;
  $('proOpen').hidden=any;
  $('proExport').disabled=!any||working; $('proPreview').disabled=!any||working;
  if(proResult && proResult.fingerprint!==proFingerprint()) proInvalidate('편집 내용이 바뀌었습니다. 결과를 다시 만들어 주세요.');
  syncProAction();syncProSummaries();
  syncLivePreview();
  if(typeof syncToolsState==='function'&&typeof toolsRevision!=='undefined')syncToolsState();
  if(!any) $('proStatus').textContent='파일을 추가하면 시작할 수 있어요.';
  else if(!working && !proResult) $('proStatus').textContent=`${pages.length}페이지 · 문서 전체에 적용`;
}
function setProView(view){
  document.body.dataset.proView=view;
  $('proWorkspace').setAttribute('aria-pressed',String(view==='workspace'));
  $('proSettings').setAttribute('aria-pressed',String(view==='settings'));
  measureActionBar();
  requestAnimationFrame(()=>{const p=pages.find(p=>p.uid===previewUid);if(p)showPreview(p);});
}
let proModeRequest=0;
function setProMode(mode){
  const request=++proModeRequest;
  if(typeof textEditPending!=='undefined'&&textEditPending){
    // A mode click must finish the newest layout, even if another keystroke or
    // formatting change supersedes the promise while it is being awaited.
    return (async()=>{
      do{await textUpdate;}while(request===proModeRequest&&textEditPending);
      if(request!==proModeRequest)return false;
      return applyProMode(mode);
    })();
  }
  return applyProMode(mode);
}
function applyProMode(mode){
  if(typeof finishTextEdit==='function'&&!finishTextEdit(true))return false;
  proMode=mode; document.body.dataset.mode=mode;
  $('modeBasic').setAttribute('aria-pressed',String(mode==='basic'));
  $('modePro').setAttribute('aria-pressed',String(mode==='pro'));
  $('proPanel').hidden=mode!=='pro'; $('proMobileSwitch').hidden=mode!=='pro';
  $('btnSave').querySelector('span').textContent=mode==='pro'?'Pro 결과 만들기':'PDF로 저장';
  $('btnSave').title=mode==='pro'?'현재 Pro 설정으로 결과를 만듭니다':'Basic 편집본을 저장합니다';
  setProView('workspace');
  // Only a UI preference is stored. Documents and result bytes stay in memory.
  try{localStorage.setItem('pdfed-mode',mode);}catch(_){}
  if(mode==='basic'){syncPreviewVisible();$('btnPreview').title='미리보기 표시 / 숨기기';}
  syncProState();
  return true;
}
function proNumberInput(id,min,max,integer=false){
  const el=$(id), n=Number(el.value);
  if(el.value.trim()===''||!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n))){
    el.focus();throw new Error(`${el.labels?.[0]?.textContent.trim()||'설정'}: ${min}~${max} 범위의 ${integer?'정수':'숫자'}를 입력하세요.`);
  }
  return n;
}
function readProOptions(strict=false){
  const crop=$('proCrop').checked, number=$('proNumber').checked;
  const options={
    optimize:$('proOptimize').checked,maxDimension:Number($('proResolution').value),jpegQuality:Number($('proQuality').value)/100,
    blackWhite:$('proGrayscale').checked,bwThreshold:Number($('proBWThreshold').value),contrast:$('proGrayscale').checked?0:Number($('proContrast').value),whitePoint:$('proGrayscale').checked?255:Number($('proWhitePoint').value),
    rasterize:$('proOptimize').checked&&$('proCompressionMode').value==='raster',
    deskew:$('proDeskew').checked,crop,margins:crop ? ['Top','Right','Bottom','Left'].map(s=>proNumberInput('proCrop'+s,0,100)) : [0,0,0,0],
    paper:$('proPaper').value,number,startNumber:number?proNumberInput('proStartNumber',1,999999,true):1,
    skipPages:number?proNumberInput('proSkipPages',0,99999,true):0,
    numberPosition:$('proNumberPosition').value,watermark:$('proWatermark').value.trim().slice(0,40)
  };
  return typeof readToolOptions==='function'&&typeof toolsRevision!=='undefined'?readToolOptions(options,strict):options;
}
function refreshProControls(){
  $('proBWThresholdValue').value=$('proBWThreshold').value;
  $('proBWThreshold').disabled=!$('proGrayscale').checked;
  $('proContrast').disabled=$('proGrayscale').checked;$('proWhitePoint').disabled=$('proGrayscale').checked;
  $('proRasterWarning').hidden=!$('proOptimize').checked||$('proCompressionMode').value!=='raster';
  $('proCompressionMode').disabled=!$('proOptimize').checked;
  $('proQualityValue').value=$('proQuality').value+'%';
  $('proContrastValue').value=$('proContrast').value;
  $('proWhitePointValue').value=$('proWhitePoint').value;
  ['proPreset','proResolution','proQuality'].forEach(id=>$(id).disabled=!$('proOptimize').checked);
  $('proQuality').disabled=!$('proOptimize').checked||$('proGrayscale').checked;
  $('proPreserveText').textContent=$('proOptimize').checked&&$('proCompressionMode').value==='raster'?'페이지 전체를 이미지로 압축합니다. 결과에는 검색·복사·링크·양식이 유지되지 않습니다.':'기존 텍스트와 검색 정보를 유지하며 이미지와 페이지 설정을 조정합니다.';
  ['Top','Right','Bottom','Left'].forEach(s=>$('proCrop'+s).disabled=!$('proCrop').checked);
  ['proStartNumber','proSkipPages','proNumberPosition'].forEach(id=>$(id).disabled=!$('proNumber').checked);
  $('proNumberFields').hidden=!$('proNumber').checked;
  $('proNumberPosition').closest('label').hidden=!$('proNumber').checked;
  $('proCropFields').hidden=!$('proCrop').checked;
  $('proBWThreshold').closest('label').hidden=!$('proGrayscale').checked;
  $('proBWHelp').hidden=!$('proGrayscale').checked;
  for(const id of ['proContrast','proWhitePoint'])$(id).closest('label').hidden=$('proGrayscale').checked;
  for(const id of ['proCompressionMode','proPreset','proResolution','proQuality'])$(id).closest('label').hidden=!$('proOptimize').checked||(id==='proQuality'&&$('proGrayscale').checked);
  syncProSummaries();
}
function syncProSummaries(){
  const set=(id,items)=>{const el=$(id);el.textContent=items.filter(Boolean).join(' · ')||'사용 안 함';el.closest('details').classList.toggle('has-settings',items.some(Boolean));};
  set('proNumberSummary',[$('proNumber').checked&&'페이지 번호',$('proWatermark').value.trim()&&'워터마크']);
  set('proPageSummary',[$('proDeskew').checked&&'자동 기울기',$('proCrop').checked&&'여백 재단',$('proPaper').value==='a4'&&'A4']);
  set('proScanSummary',[$('proGrayscale').checked?'B&W 흑백':Number($('proContrast').value)>0&&'대비 강화',!$('proGrayscale').checked&&Number($('proWhitePoint').value)<255&&'배경 정리']);
  set('proOptimizeSummary',[$('proOptimize').checked&&($('proCompressionMode').value==='raster'?'페이지 전체 압축':'텍스트 유지'),$('proOptimize').checked&&$('proResolution').value+' px']);
}
function resetProOptions(){
  if(typeof resetTools==='function')resetTools();
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
  const result=await PDFProPipeline.apply(doc,options,{signal,docOptions:DOC_OPTS,pageOffset,pageIds:pages.map(p=>p.uid),onProgress:(n,label)=>{progress(20+n*58);busy(true,label);}});
  checkProAbort();return {...result.report,outputDoc:result.doc,settings:describeProSettings(options,result.report,result.report.deskew)};
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
function describeProSettings(o,report,deskew,offset){
  const applied=[];
  if(o.number){
    if(offset===undefined)applied.push(`번호 ${o.startNumber}부터 · 앞 ${o.skipPages}쪽 제외`);
    else applied.push(offset>=o.skipPages?`페이지 번호 ${o.startNumber+offset-o.skipPages}`:'이 페이지는 번호 제외');
  }
  if(o.watermark)applied.push('워터마크');
  if(report.stamps)applied.push(`도장 ${report.stamps}곳`);
  if(report.ocr?.pages)applied.push(`검색용 OCR ${report.ocr.pages}쪽 · ${report.ocr.words}단어`);
  if(o.deskew)applied.push(offset===undefined?`기울기 ${deskew.changed}쪽 보정`:deskew.pages[0]?.angle?`기울기 ${Math.abs(deskew.pages[0].angle).toFixed(1)}° 보정`:`기울기 유지 · ${deskew.pages[0]?.reason||'변경 없음'}`);
  if(o.crop&&o.margins.some(n=>n>0))applied.push('여백 재단');
  if(o.paper==='a4')applied.push('A4 맞춤');
  if(o.rasterize)applied.push('페이지 전체 압축 · 검색·복사 불가');
  const scan=o.blackWhite||o.grayscale||o.contrast>0||o.whitePoint<255;
  if(scan){
    if(report.changed){if(o.blackWhite)applied.push('B&W 흑백');else if(o.grayscale)applied.push('회색조');if(o.contrast>0)applied.push(`대비 +${o.contrast}`);if(o.whitePoint<255)applied.push(`흰 배경 ${o.whitePoint}`);}
    else applied.push(report.imageCount?'스캔 보정: 변경된 이미지 없음':'스캔 보정: 이미지 없음 (텍스트·벡터 유지)');
  }
  if(o.optimize)applied.push(o.rasterize?`${report.changed}쪽 압축`:`이미지 ${report.changed}개 압축·보정`);
  return applied.join(' · ')||'원본 설정';
}
function proSummary(report,textCheck){
  const lines=[report.rasterized?`${report.changed}쪽을 이미지 PDF로 압축`:`이미지 ${report.changed}개 변경 · ${report.skipped}개 원본 유지`];
  if(textCheck.rasterized)lines.push(report.ocr?.pages?'페이지를 이미지로 저장한 뒤 확인한 OCR을 추가했습니다. 원래 텍스트·링크·양식은 유지되지 않습니다.':'페이지를 이미지로 저장했습니다. 검색·복사·링크·양식은 유지되지 않습니다.');
  else if(textCheck.characters)lines.push(`기존 텍스트 ${textCheck.characters.toLocaleString()}자 보존 확인`);
  else lines.push('원래 검색 가능한 텍스트가 없는 문서입니다.');
  if(report.settings)lines.unshift(report.settings);
  if(report.deskew?.pages.length){
    const corrected=report.deskew.pages.filter(p=>p.angle);
    if(corrected.length)lines.push('기울기 보정: '+corrected.map(p=>`${p.page}쪽 ${Math.abs(p.angle).toFixed(1)}°`).join(', '));
    const kept=report.deskew.pages.filter(p=>!p.angle);
    if(kept.length)lines.push('기울기 유지: '+kept.map(p=>`${p.page}쪽 (${p.reason})`).join(', '));
  }
  if(report.notes?.length)lines.push(...report.notes);
  return lines.join('\n');
}
async function createProResult({reveal=true}={}){
  if(!pages.length||document.body.classList.contains('is-busy'))return;
  let options;try{options=readProOptions(true);}catch(e){toast(e.message,true);return;}
  proInvalidate();startProWork('편집본을 준비하는 중…');await idle();
  try{
    const edited=await buildEditedDocument();checkProAbort();
    const fingerprint=proFingerprint();
    const original=PDFProResult.unchangedSource(pages,docs);
    const before=await edited.save({useObjectStreams:true,updateFieldAppearances:false});
    // Reload the baseline so new marks cannot reuse cached, already-saved
    // content streams created while baking the user's Basic annotations.
    const doc=await PDFLib.PDFDocument.load(before);checkProAbort();
    const report=await processProDoc(doc,options,0);
    const candidate=await report.outputDoc.save({useObjectStreams:true,updateFieldAppearances:false});checkProAbort();
    const result=PDFProResult.selectOutput(before,candidate,options,original);
    const bytes=result.bytes;
    const textCheck=report.rasterized&&!result.retained?{rasterized:true,characters:0}:await verifyProText(before,bytes,proAbort.signal);checkProAbort();
    proResult={bytes,fingerprint};
    $('proBeforeLabel').textContent=result.originalBasis?'입력 PDF':'최적화 전 편집본';
    $('proBeforeSize').textContent=formatBytes(result.reference.length);$('proAfterSize').textContent=formatBytes(bytes.length);
    const change=result.reduction;
    $('proReduction').textContent=Math.abs(change)<.1 ? '현재 설정으로는 용량이 거의 줄지 않습니다.' : change>0 ? `${change.toFixed(1)}% 절감 · ${formatBytes(result.reference.length-bytes.length)}` : `${(-change).toFixed(1)}% 증가 · 보정·페이지 설정이 반영됐어요`;
    const imageShare=Math.min(100,report.originalImageBytes/result.reference.length*100);
    let composition=`입력 이미지 ${report.sourceImageCount??report.imageCount}개 · ${formatBytes(report.originalImageBytes)} · 전체 용량의 ${imageShare.toFixed(1)}%`;
    if(imageShare<10&&!report.rasterized)composition+='\n이미지 비중이 낮아 품질을 낮춰도 용량 절감 효과가 작습니다. 텍스트·벡터는 유지합니다. 더 큰 절감이 필요하면 페이지 전체 압축을 선택해 보세요.';
    if(result.structureSaved)composition+=`\nPDF 구조 정리로 ${formatBytes(result.structureSaved)} 절감한 내역을 포함합니다.`;
    $('proComposition').textContent=composition;
    const outputReport=result.retained?{...report,rasterized:false,changed:0,skipped:report.imageCount,settings:'추가 압축으로 더 줄지 않아 변경 전 파일 유지',notes:['추가 압축본이 더 작지 않아 가장 작은 변경 전 파일을 유지했습니다.']}:report;
    $('proReport').textContent=proSummary(outputReport,textCheck);$('proResult').hidden=false;
    $('proStatus').textContent='결과를 확인하고 다운로드하세요.';
    if(reveal)$('proResult').scrollIntoView({behavior:'smooth',block:'nearest'});
    return proResult;
  }catch(e){
    if(e.name==='AbortError')toast('작업을 취소했습니다. 편집 중인 문서는 유지됩니다.');
    else{console.error(e);toast(e.message||'Pro 결과를 만들지 못했습니다.',true);$('proStatus').textContent=e.message;}
  }finally{finishProWork();}
}
$('modeBasic').onclick=()=>setProMode('basic');
$('modePro').onclick=()=>{
  if(proMode!=='pro')return setProMode('pro');
  proModeRequest++; // Staying in Pro cancels a pending Basic request without resetting its view.
};
$('proWorkspace').onclick=()=>{setProView('workspace');document.querySelector('main').scrollTop=0;};$('proSettings').onclick=()=>{document.querySelector('main').scrollTop=0;setProView('settings');if(!proPreviewOpen)$('proPanel').scrollIntoView({behavior:'smooth',block:'start'});};
$('proOpen').onclick=()=>pickFiles(false);
$('proPreset').onchange=()=>{const p=proPresets[$('proPreset').value];$('proResolution').value=p.resolution;$('proQuality').value=p.quality;refreshProControls();proInvalidate();if(typeof syncToolsState==='function')syncToolsState();scheduleLivePreview();};
for(const id of proControlIds)$(id).addEventListener('input',()=>{refreshProControls();proInvalidate('설정이 바뀌었습니다. 결과를 다시 만들어 주세요.');if(typeof syncToolsState==='function')syncToolsState();scheduleLivePreview();});
$('proReset').onclick=resetProOptions;$('proExport').onclick=proPrimaryAction;$('proPreview').onclick=()=>setLivePreviewOpen(!proPreviewOpen);
function proPrimaryAction(){return proResult?downloadProResult():createProResult();}
function downloadProResult(){
  if(!proResult)return;
  if(proResult.fingerprint!==proFingerprint()){proInvalidate();syncProState();toast('편집 내용이 바뀌었습니다. 결과를 다시 만들어 주세요.',true);return;}
  const name=($('proFilename').value.trim().replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'')||'편집본').slice(0,100);
  downloadPdf(proResult.bytes,name+'.pdf');toast('Pro 결과 PDF 다운로드를 시작했습니다');
}
$('proDownload').onclick=downloadProResult;
const proAddFiles=document.createElement('button');proAddFiles.id='proAddFiles';proAddFiles.className='btn pro-add-files';proAddFiles.textContent='+ 파일 추가';proAddFiles.onclick=()=>pickFiles(false);document.querySelector('.tools').prepend(proAddFiles);
$('proDiscard').onclick=()=>{proInvalidate();syncProState();};
$('busyCancel').onclick=()=>{proAbort?.abort();$('busyCancel').disabled=true;$('busyText').textContent='작업을 취소하는 중…';globalThis.PDFWorkProgress?.cancel();};
proReady=true;refreshProControls();
let savedProMode='basic';try{if(localStorage.getItem('pdfed-mode')==='pro')savedProMode='pro';}catch(_){}
setProMode(savedProMode);
