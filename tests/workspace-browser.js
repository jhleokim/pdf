(async()=>{
 const out=document.getElementById('workspaceChecks'),checks=[],assert=(v,m)=>{if(!v)throw Error(m)},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const ready=async()=>{for(let i=0;i<400;i++){await wait(30);if(!proAbort&&$('proCompare').getAttribute('aria-busy')!=='true')return}throw Error('Preview timed out')};
 const record=m=>{checks.push(m);out.textContent=checks.join('\n')},change=(id,v)=>{const el=$(id);if(el.type==='checkbox')el.checked=v;else el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}))};
 const apply=PDFProPipeline.apply;let processing=0,downloads=0;PDFProPipeline.apply=async(...args)=>{processing++;return apply(...args)};
 try{
  setProMode('pro');setProView('settings');await loadFiles([new File([b64bytes(TEST_SCAN)],'Workspace test.pdf',{type:'application/pdf'})]);await ready();
  assert($('proNumberFields').hidden&&$('proCropFields').hidden,'Disabled settings remain expanded');
  const count=processing,docsBefore=liveDocs;
  $('compareZoom').value='2';$('compareZoom').dispatchEvent(new Event('change'));await ready();
  assert(processing===count&&liveDocs===docsBefore,'Zoom reran transformations');record('Zoom reuses verified PDFs');
  change('proNumber',true);assert(!$('proNumberFields').hidden&&$('proNumberSummary').textContent.includes('페이지 번호'),'Active setting summary missing');await ready();assert(processing>count,'Settings did not invalidate preview');record('Settings reveal fields and invalidate the cached result');
  await proPrimaryAction();await ready();assert(proResult&&$('proExportLabel').textContent==='PDF 다운로드','Primary action did not switch to download');
  const result=proResult.bytes,beforeDownload=processing,download=downloadPdf;downloadPdf=(bytes)=>{assert(bytes===result,'Downloaded wrong result');downloads++};
  try{await proPrimaryAction();await save()}finally{downloadPdf=download}
  assert(downloads===2&&processing===beforeDownload,'Download reran processing');
  change('proWatermark','검토');assert(!proResult&&$('proExportLabel').textContent==='결과 만들기','Edited settings still offer stale download');await ready();record('Primary button and keyboard save download prepared output; edits invalidate it');
  setLivePreviewOpen(false);await liveQueue;assert(!liveCache&&!liveDocs.length,'Closing retained cached PDFs');setLivePreviewOpen(true);await ready();record('Close releases preview resources; reopen works');
  setProMode('basic');await Promise.all([showPreview(pages[0]),showPreview(pages[1]),showPreview(pages[0])]);await wait(100);assert(previewUid===pages[0].uid&&$('pvCanvas').width>0,'Rapid Basic navigation failed');record('Rapid Basic page changes leave the current page rendered');
  setProMode('pro');setProView('settings');await ready();
  if(innerWidth<=880){const button=$('proAddFiles'),r=button.getBoundingClientRect();assert(r.height>=44&&r.width>0&&getComputedStyle(button).display!=='none','Mobile file addition is inaccessible');assert($('proPanel').getBoundingClientRect().height>=170,'Settings panel has no usable space');record('Mobile file addition and settings stay accessible');}
  const originalConfirm=window.confirm;window.confirm=()=>true;try{$('btnReset').click()}finally{window.confirm=originalConfirm}await liveQueue;
  assert(pages.length===0&&docs.size===0&&!liveCache&&!liveDocs.length&&ocrRecords.length===0&&!stampAsset,'Document reset retained work resources');record('Document reset clears PDFs, previews and OCR');
  out.textContent='PASS · '+checks.length+' workspace checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e)}finally{PDFProPipeline.apply=apply;if(parent!==window)parent.postMessage({workspaceReport:out.textContent},location.origin)}
})();
