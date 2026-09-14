'use strict';
let proMode='basic', proResult=null, proAbort=null;
let proReady=false;
const proPresets={quality:{resolution:3200,quality:92},balanced:{resolution:2400,quality:82},small:{resolution:1200,quality:50}};
const proControlIds=['proOptimize','proCompressionMode','proBWThreshold','proPreset','proResolution','proQuality','proGrayscale','proContrast','proWhitePoint','proDeskew','proCrop','proCropTop','proCropRight','proCropBottom','proCropLeft','proPaper','proNumber','proStartNumber','proSkipPages','proNumberPosition','proWatermark'];
const formatBytes=n=> n>=1048576 ? (n/1048576).toFixed(2)+' MB' : (n/1024).toFixed(1)+' KB';
function proFingerprint(){return JSON.stringify(pages.map(p=>[p.uid,p.docId,p.srcIndex,p.rotation,p.annots||[],p.deskewAngle,p.deskewCrop===true]));}
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
  if(typeof syncDeskewControls==='function')syncDeskewControls();
  if(typeof syncToolsState==='function'&&typeof toolsRevision!=='undefined')syncToolsState();
  if(!any) $('proStatus').textContent='파일을 추가하면 시작할 수 있어요.';
  else if(!working && !proResult) $('proStatus').textContent=`${pages.length}페이지 · 문서 전체에 적용`;
}
function setProView(view){
  if(view==='settings'&&typeof setDeskewInteraction==='function')setDeskewInteraction(false);
  document.body.dataset.proView=view;
  $('proWorkspace').setAttribute('aria-pressed',String(view==='workspace'));
  $('proSettings').setAttribute('aria-pressed',String(view==='settings'));
  measureActionBar();
  requestAnimationFrame(()=>{const p=pages.find(p=>p.uid===previewUid);if(p)showPreview(p);});
}
let proModeRequest=0;
function setProMode(mode){
  const request=++proModeRequest;
  if(typeof proTransferPending!=='undefined'&&proTransferPending)return proTransferPending.then(()=>request===proModeRequest?applyProMode(mode):false);
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
  if(mode==='basic'&&proMode==='pro'&&proReady&&pages.length){try{if(hasProEdits())return transferProToBasic(proModeRequest);}catch(e){toast(e.message,true);return false;}}
  return displayProMode(mode);
}
function displayProMode(mode){
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
function hasProEdits(){
  const o=readProOptions();
  return o.optimize||o.deskew||o.blackWhite||o.contrast>0||o.whitePoint<255||o.crop||o.paper!=='original'||o.number||!!o.watermark||o.stamps?.length||o.ocr?.length||Object.keys(o.deskewAngles).length;
}
function captureProTransferSettings(){return {fields:Object.fromEntries(proControlIds.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value])),records:ocrRecords.slice(),accepted:ocrAccepted,mode:proMode};}
function restoreProTransferSettings(state){for(const[id,v]of Object.entries(state.fields)){if($(id).type==='checkbox')$(id).checked=v;else $(id).value=v;}ocrRecords=state.records.slice();ocrAccepted=state.accepted;refreshProControls();proInvalidate();displayProMode(state.mode);}
let proTransferPending=null;
function transferProToBasic(request){
  if(proTransferPending)return proTransferPending;
  if(document.body.classList.contains('is-busy'))return false;
  proTransferPending=(async()=>{
   if(typeof reviewStampPending==='function'&&reviewStampPending()){toast('스탬프 문구 반영 후 다시 전환해 주세요.');return false;}
   const snapshot=captureEditHistory(),settings=captureProTransferSettings(),shown=previewUid,picked=new Set(selected().map(p=>p.uid));let pdf;
   const result=await createProResult({reveal:false});if(!result||request!==proModeRequest)return false;
   if(result.hasPageEffects===false)return displayProMode('basic');
   startProWork('Pro 편집 내용을 Basic에 반영하는 중…');
   try{
    pdf=await pdfjsLib.getDocument({data:result.bytes.slice(),...DOC_OPTS}).promise;checkProAbort();
    const next=[];for(let i=0;i<pages.length;i++){const canvas=await renderThumb(pdf,i+1);checkProAbort();next.push({uid:pages[i].uid,docId:'',srcIndex:i,rotation:0,annots:[],canvas});progress((i+1)/pages.length*100);await idle();}
    if(request!==proModeRequest)return false;
    const docId='d'+(++docSeq),name=docs.get(pages[0].docId)?.name||'편집본.pdf';for(const p of next)p.docId=docId;
    // Publish only after every page succeeds. Original pages remain in undo history.
    clearPreview();docs.clear();docs.set(docId,{name,libBytes:result.bytes.slice(),pdfjsDoc:pdf,kind:'pdf',color:SWATCH[(docSeq-1)%SWATCH.length],count:next.length});pdf=null;pages=next;
    resetTools();for(const id of proControlIds){const e=$(id);if(e.type==='checkbox')e.checked=false;else if(e.tagName==='SELECT')e.value=[...e.options].find(o=>o.defaultSelected)?.value||e.options[0].value;else e.value=e.defaultValue;}refreshProControls();
    proInvalidate();displayProMode('basic');render();for(const p of pages)p.el.classList.toggle('selected',picked.has(p.uid));previewUid=shown;syncCounts();await showPreview(pages.find(p=>p.uid===shown)||pages[0]);
    const after=captureEditHistory();snapshot.proTransfer=settings;after.proTransfer=captureProTransferSettings();editHistory.push(snapshot,after,'Pro 편집을 Basic에 반영');collectHistoryDocuments();syncHistoryControls();
    toast('Pro 편집을 반영했습니다. Ctrl+Z로 전환 전 편집 상태를 복원할 수 있습니다.');return true;
   }catch(e){if(e.name!=='AbortError'){console.error(e);toast('Basic으로 전환하지 못했습니다. Pro 편집 내용은 유지됩니다.',true);}return false;}
   finally{if(pdf)await pdf.destroy().catch(()=>{});finishProWork();}
  })().finally(()=>{proTransferPending=null;});return proTransferPending;
}
function proNumberInput(id,min,max,integer=false){
  const el=$(id), n=Number(el.value);
  if(el.value.trim()===''||!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n))){
    el.focus();throw new Error(`${el.labels?.[0]?.textContent.trim()||'설정'}: ${min}~${max} 범위의 ${integer?'정수':'숫자'}를 입력하세요.`);
  }
  return n;
}
function readProOptions(strict=false){
  if(strict&&typeof validateDeskewInput==='function')validateDeskewInput();
  const crop=$('proCrop').checked, number=$('proNumber').checked;
  const options={
    optimize:$('proOptimize').checked,maxDimension:Number($('proResolution').value),jpegQuality:Number($('proQuality').value)/100,
    blackWhite:$('proGrayscale').checked,bwThreshold:Number($('proBWThreshold').value),contrast:$('proGrayscale').checked?0:Number($('proContrast').value),whitePoint:$('proGrayscale').checked?255:Number($('proWhitePoint').value),
    rasterize:$('proOptimize').checked&&$('proCompressionMode').value==='raster',
    deskew:$('proDeskew').checked,deskewAngles:Object.fromEntries(pages.filter(p=>Number.isFinite(p.deskewAngle)).map(p=>[p.uid,p.deskewAngle])),
    deskewCropByPage:Object.fromEntries(pages.filter(p=>p.deskewCrop===true).map(p=>[p.uid,true])),
    crop,margins:crop ? ['Top','Right','Bottom','Left'].map(s=>proNumberInput('proCrop'+s,0,100)) : [0,0,0,0],
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
  const manual=pages.filter(p=>Number.isFinite(p.deskewAngle)).length,cropCorners=pages.filter(p=>p.deskewCrop===true).length;
  set('proPageSummary',[$('proDeskew').checked&&'자동 기울기',manual&&`수동 ${manual}쪽`,cropCorners&&`모서리 자르기 ${cropCorners}쪽`,$('proCrop').checked&&'여백 재단',$('proPaper').value==='a4'&&'A4']);
  set('proScanSummary',[$('proGrayscale').checked?'B&W 흑백':Number($('proContrast').value)>0&&'대비 강화',!$('proGrayscale').checked&&Number($('proWhitePoint').value)<255&&'배경 정리']);
  set('proOptimizeSummary',[$('proOptimize').checked&&($('proCompressionMode').value==='raster'?'페이지 전체 압축':'텍스트 유지'),$('proOptimize').checked&&$('proResolution').value+' px']);
}
function resetProOptions(){
  if(typeof resetPageDeskewAngles==='function')resetPageDeskewAngles();
  if(typeof resetTools==='function')resetTools();
  for(const id of proControlIds){const e=$(id);if(e.type==='checkbox')e.checked=e.defaultChecked;else if(e.tagName==='SELECT')e.value=[...e.options].find(o=>o.defaultSelected)?.value||e.options[0].value;else e.value=e.defaultValue;}
  refreshProControls();proInvalidate();syncProState();scheduleLivePreview();toast('Pro 설정을 초기화했습니다');
}
function checkProAbort(){proAbort?.signal.throwIfAborted();}
function startProWork(label){
  cancelLivePreview();
  proAbort=new AbortController();$('busyCancel').hidden=false;$('busyCancel').disabled=false;
  busy(true,label);syncProState();
}
function finishProWork(){proAbort=null;$('busyCancel').hidden=true;busy(false);progress(0);syncProState();}
async function processProDoc(doc,options,pageOffset){
  const signal=proAbort.signal;
  checkProAbort();
  const result=await PDFProPipeline.apply(doc,options,{signal,docOptions:DOC_OPTS,pageOffset,pageIds:pages.map(p=>p.uid),...(typeof deskewCallbacks==='function'?deskewCallbacks(pages):{}),onProgress:(n,label)=>{progress(20+n*58);busy(true,label);}});
  checkProAbort();return {...result.report,outputDoc:result.doc,settings:describeProSettings(options,result.report,result.report.deskew)};
}
async function verifyProText(before,after,signal,quiet=false,verification={}){
  let a,b;
  try{
    a=await pdfjsLib.getDocument({data:before.slice(),...DOC_OPTS}).promise;
    b=await pdfjsLib.getDocument({data:after.slice(),...DOC_OPTS}).promise;
    if(a.numPages!==b.numPages)throw new Error('결과의 페이지 수가 달라졌습니다.');
    let characters=0,checked=0,excludedItems=0,excludedCharacters=0,uncheckedPages=0,sourceCharacters=0;
    for(let i=1;i<=a.numPages;i++){
      if(signal?.aborted)throw new DOMException('취소했습니다.','AbortError');
      const [ap,bp]=await Promise.all([a.getPage(i),b.getPage(i)]);
      const [at,bt]=await Promise.all([ap.getTextContent(),bp.getTextContent()]);
      // Include invisible OCR; an added page number may append text.
      const original=at.items.map(x=>x.str||'').join('').replace(/\s/g,'');
      sourceCharacters+=original.length;
      // Preview reports retain the original document's page number. Match by
      // array position so a one-page preview verifies its own crop geometry.
      const pageReport=verification.deskew?.pages?.[i-1];
      if(pageReport?.cropped===true){
        const check=PDFProTextVerification.verify(at,bt,pageReport,verification.options);
        if(!check.ok)throw new Error(`${i}페이지의 재단 영역 안에서 텍스트 보존을 확인하지 못했습니다. 재단을 끄거나 각도를 줄여 다시 시도해 주세요.`);
        characters+=check.characters;excludedItems+=check.excludedItems;excludedCharacters+=check.excludedCharacters||0;
        if(check.unchecked&&original)uncheckedPages++;
      }else{
        const result=bt.items.map(x=>x.str||'').join('').replace(/\s/g,'');
        if(original && !result.includes(original))throw new Error(`${i}페이지의 기존 텍스트 보존을 확인하지 못했습니다. 페이지 재단을 줄이거나 원래 크기로 다시 시도해 주세요.`);
        characters+=original.length;
      }
      checked++;
      if(!quiet){busy(true,`기존 텍스트 확인 중… ${i}/${a.numPages}`);progress(80+i/a.numPages*18);}
      await idle();
    }
    return {characters,checked,excludedItems,excludedCharacters,uncheckedPages,sourceCharacters};
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
  if(o.deskew||Object.keys(o.deskewAngles||{}).length){
    const page=deskew?.pages?.[0],angle=Number.isFinite(page?.displayAngle)?page.displayAngle:-(page?.angle||0);
    if(offset===undefined)applied.push(`기울기 ${deskew?.changed||0}쪽 보정`);
    else if(page?.angle)applied.push(`${page.mode==='manual'?'수동':'자동'} 기울기 ${angle>0?'+':''}${angle.toFixed(1)}°`);
    else applied.push(page?.mode==='manual'?'수동 0.0° · 원본 각도 유지':`기울기 유지 · ${page?.reason||'변경 없음'}`);
  }
  const cornerPages=deskew?.pages?.filter(p=>p.cropCorners===true)||[],cropped=cornerPages.filter(p=>p.cropped===true);
  if(cornerPages.length)applied.push(offset===undefined?(cropped.length?`빈 모서리 ${cropped.length}쪽 자르기`:'빈 모서리 자르기 · 변경 없음'):(cropped.length?'빈 모서리 자르기':'빈 모서리 유지'));
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
  else if(textCheck.characters)lines.push(`${textCheck.excludedItems?'재단 영역 안의':'기존'} 텍스트 ${textCheck.characters.toLocaleString()}자 보존 확인`);
  else if(textCheck.sourceCharacters)lines.push('재단 영역 안에서 검증할 텍스트가 없습니다.');
  else lines.push('원래 검색 가능한 텍스트가 없는 문서입니다.');
  if(textCheck.excludedItems)lines.push(`재단 경계·영역 밖 또는 위치를 확인할 수 없는 텍스트 ${textCheck.excludedItems.toLocaleString()}개 항목은 보존 검증에서 제외했습니다. 원본과 비교해 주세요.`);
  if(textCheck.uncheckedPages&&textCheck.characters)lines.push(`${textCheck.uncheckedPages}쪽은 재단 영역 안에서 검증할 텍스트가 없습니다.`);
  if(report.settings)lines.unshift(report.settings);
  if(report.deskew?.pages.length){
    const corrected=report.deskew.pages.filter(p=>p.angle);
    if(corrected.length)lines.push('기울기 보정: '+corrected.map(p=>{const angle=Number.isFinite(p.displayAngle)?p.displayAngle:-p.angle;return `${p.page}쪽 ${p.mode==='manual'?'수동':'자동'} ${angle>0?'+':''}${angle.toFixed(1)}°`;}).join(', '));
    const kept=report.deskew.pages.filter(p=>!p.angle);
    if(kept.length)lines.push('기울기 유지: '+kept.map(p=>`${p.page}쪽 (${p.reason})`).join(', '));
    const cropped=report.deskew.pages.filter(p=>p.cropped===true);
    if(cropped.length)lines.push('빈 모서리 자르기: '+cropped.map(p=>`${p.page}쪽`).join(', '));
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
    const textCheck=report.rasterized&&!result.retained?{rasterized:true,characters:0}:await verifyProText(before,bytes,proAbort.signal,false,{deskew:report.deskew,options});checkProAbort();
    const hasPageEffects=!result.retained&&!!(report.changed||report.stamps||report.ocr?.pages||report.deskew?.changed||options.number||options.watermark||options.paper!=='original'||options.crop&&options.margins.some(n=>n>0));
    proResult={bytes,fingerprint,hasPageEffects};
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
const proAddFiles=document.createElement('button');proAddFiles.id='proAddFiles';proAddFiles.className='btn pro-add-files';proAddFiles.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg><span>파일 추가</span>';proAddFiles.setAttribute('aria-label','PDF 또는 사진 추가');proAddFiles.title='PDF 또는 사진 추가';proAddFiles.onclick=()=>pickFiles(false);document.querySelector('.tools').prepend(proAddFiles);
$('proDiscard').onclick=()=>{proInvalidate();syncProState();};
$('busyCancel').onclick=()=>{proAbort?.abort();$('busyCancel').disabled=true;$('busyText').textContent='작업을 취소하는 중…';globalThis.PDFWorkProgress?.cancel();};
proReady=true;refreshProControls();
let savedProMode='basic';try{if(localStorage.getItem('pdfed-mode')==='pro')savedProMode='pro';}catch(_){}
setProMode(savedProMode);
