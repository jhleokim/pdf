(async()=>{
  const result=$('toolsTestResult'),checks=[];
  const assert=(ok,message)=>{if(!ok)throw new Error(message);};
  const record=(name)=>{checks.push(name);result.textContent=checks.join('\n');};
  const change=(id,value)=>{const el=$(id);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const ready=async()=>{for(let i=0;i<200;i++){if($('proCompare').getAttribute('aria-busy')!=='true'&&!proAbort)return;await wait(100);}throw new Error('Preview did not finish');};
  try{
    setProMode('pro');await loadFiles([new File([b64bytes(TEST_SCAN)],'Synthetic scan.pdf',{type:'application/pdf'})]);await ready();
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;const ctx=canvas.getContext('2d');ctx.strokeStyle='#b21f2d';ctx.lineWidth=8;ctx.strokeRect(5,5,90,90);
    activateStamp({data:canvas.toDataURL(),ratio:1,name:'Test seal'});change('stampScope','selected');pages[1].el.click();await ready();
    assert(readProOptions().stamps[0].targets.length===1&&readProOptions().stamps[0].targets[0]===pages[1].uid,'Selected stamp targets wrong');
    $('stampCommit').click();assert(stampMarks.length===1&&!stampAsset,'Stamp commit failed');
    await createProResult();assert(proResult,'No PDF output');const first=proResult.bytes.slice();
    const parsed=await PDFLib.PDFDocument.load(first);assert(parsed.getPageCount()===2,'Page count changed');record('Selected stamp, commit and PDF export');
    $('stampPlacements').querySelector('button').click();assert(stampAsset&&selected().length===1,'Editing forgot selected targets');change('stampWidth',45);$('stampCommit').click();assert(stampMarks.length===1,'Editing duplicated stamp');record('Edit keeps scope without duplication');
    $('stampPlacements').querySelector('button').click();change('stampWidth',60);$('stampClear').click();assert(stampMarks.length===1&&stampMarks[0].width===45,'Cancel did not restore previous placement');record('Cancel stamp edit restores original placement');
    $('stampPlacements').querySelector('button:last-child').click();assert(stampMarks.length===0,'Stamp removal failed');
    showPreview(pages[0]);await ready();await runOCR(true);
    assert(ocrRecords.length===1&&ocrRecords[0].text.includes('123,450'),'OCR sample failed');assert(!readProOptions().ocr.length,'Unconfirmed OCR leaked into export');
    $('ocrAccept').click();assert(readProOptions(true).ocr.length===1,'OCR acceptance failed');
    await createProResult();assert(proResult,'Searchable output missing');
    const pdf=await pdfjsLib.getDocument({data:proResult.bytes.slice(),...DOC_OPTS}).promise;
    const text=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str).join('');const second=(await(await pdf.getPage(2)).getTextContent()).items.map(x=>x.str).join('');await pdf.destroy();
    assert(text.includes('123,450')&&text.includes('유지합니다')&&!second.trim(),'OCR page scope or Korean extraction failed');record('Sample, explicit acceptance, scoped searchable output');
    change('proQuality',80);let stale=false;try{readProOptions(true);}catch(e){stale=true;}assert(stale&&$('ocrStatus').textContent.includes('바뀌었'),'Stale OCR not blocked');change('proQuality',82);assert(readProOptions(true).ocr.length===1,'Restoring settings should restore valid OCR');record('Changed settings invalidate OCR and export');
    const old=ocrRecords;const pending=runOCR(false);await wait(150);$('busyCancel').click();await pending;assert(ocrRecords===old&&!proAbort,'Cancel discarded prior results or left busy lock');record('Cancellation retains prior OCR and unlocks UI');
    const searchable=proResult?.bytes||first; // Generate current accepted result if cancellation invalidated only the download.
    await createProResult();const checked=proResult.bytes.slice();resetTools();await loadFiles([new File([checked],'Already searchable.pdf',{type:'application/pdf'})]);showPreview(pages[2]);await ready();await runOCR(true);
    assert(ocrRecords[0].skipped,'Existing OCR should not be duplicated');record('Existing searchable page skips duplicate OCR');
    result.textContent='PASS · '+checks.length+' UI checks\n'+checks.join('\n');
  }catch(e){result.textContent='FAIL · '+e.message+'\n'+checks.join('\n');console.error(e);}
})();
