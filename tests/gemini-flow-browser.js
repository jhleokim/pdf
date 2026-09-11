(async()=>{
  const report=$('geminiFlowChecks'),checks=[],assert=(value,message)=>{if(!value)throw Error(message);};
  const record=message=>{checks.push(message);report.textContent=checks.join('\n');};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(check,message){for(let i=0;i<600;i++){if(check())return;await wait(25);}throw Error(message);}
  const ready=()=>until(()=>!ocrRunning&&!proAbort&&$('proCompare').getAttribute('aria-busy')!=='true','OCR or preview stayed busy');
  if(TEST_STANDALONE){
    try{
      assert(typeof PDFGemini==='undefined','Standalone exposes the cloud client');
      assert(!document.querySelector('[id^="gemini"]:not(#geminiFlowChecks)'),'Standalone exposes Gemini UI');
      for(let i=0;i<12;i++)$('modePro').click();
      assert(typeof PDFGemini==='undefined'&&!document.querySelector('[id^="gemini"]:not(#geminiFlowChecks)'),'Hidden clicks restored cloud OCR');
      assert(typeof PDFOCR.session==='function','Standalone lost local OCR');
      report.textContent='PASS · 4 standalone isolation checks';
    }catch(error){report.textContent='FAIL · '+error.message;console.error(error);}
    return;
  }
  const originalCloud=PDFGemini.session,originalLocal=PDFOCR.session,originalAvailable=PDFGemini.available;
  const cloud=[],local=[];let failOn=0,holdOn=0;
  const output=()=>({text:'Gemini scan recognition 12345',words:[{text:'Gemini scan recognition 12345',box:[.1,.1,.85,.15],separator:'\n',confidence:null}],confidence:null,source:'gemini',model:'test-model'});
  PDFGemini.available=async()=>({available:true,model:'test-model'});
  PDFGemini.session=async(language,signal,onProgress,consent)=>{
    assert(consent===true,'Session opened without explicit consent');
    return {close:async()=>{},recognize:async canvas=>{
      signal.throwIfAborted();
      cloud.push({language,png:canvas.toDataURL('image/png')});
      onProgress?.({status:'sending page'});
      if(cloud.length===failOn)throw Error('Synthetic temporary service failure');
      if(cloud.length===holdOn)return new Promise((resolve,reject)=>{
        const abort=()=>reject(new DOMException('Synthetic cancellation','AbortError'));
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      });
      return output();
    }};
  };
  PDFOCR.session=async(language,signal)=>({close:async()=>{},recognize:async()=>{
    signal.throwIfAborted();local.push(language);
    return {text:'Local OCR result',words:[{text:'Local OCR result',box:[.1,.1,.6,.15],separator:'\n',confidence:90}],confidence:90};
  }});
  const run=(scope,force=false)=>runOCR(false,'gemini',scope,true,force);
  const records=()=>ocrRecords.filter(r=>!r.skipped).map(r=>r.uid);
  const reset=async()=>{resetTools();failOn=holdOn=0;$('ocrLanguage').value='kor+eng';$('ocrLayout').value='auto';await ready();};
  try{
    await setProMode('pro');$('proOptimize').checked=false;refreshProControls();
    const source=await PDFLib.PDFDocument.load(b64bytes(TEST_SCAN)),document=await PDFLib.PDFDocument.create();
    for(let i=0;i<3;i++){const [page]=await document.copyPages(source,[0]);document.addPage(page);}
    await loadFiles([new File([await document.save()],'Gemini synthetic scan.pdf',{type:'application/pdf'})]);
    await showPreview(pages[0]);await ready();const scan=pages.slice(0,3);

    await runOCR(false,'gemini',[scan[0]],false);assert(cloud.length===0,'Unconfirmed OCR sent a page');
    await runOCR(true);assert(local.length===1,'Local scan fixture failed');
    await run([scan[0]]);assert(cloud.length===1&&ocrRecords[0].source==='gemini','Gemini incorrectly reused local recognition');
    await run([scan[0]]);assert(cloud.length===1,'Unchanged Gemini page was uploaded twice');
    $('ocrLayout').value='6';await run([scan[0]]);assert(cloud.length===1,'Local-only layout caused another Gemini request');
    record('Consent is required; Gemini uses its own cache and ignores the local layout setting');

    await run([scan[1]]);assert(cloud.length===2&&records().length===2&&records().includes(scan[0].uid),'Current-page OCR erased another page');
    await showPreview(scan[0]);await ready();await runOCR(true);
    assert(local.length===2&&ocrRecords.find(r=>r.uid===scan[0].uid)?.source==='tesseract','Local engine reused Gemini output');
    await run([scan[0]]);assert(cloud.length===2&&records().length===2,'Switching back lost Gemini cache or other pages');
    $('ocrLanguage').value='eng';await run([scan[0]]);assert(cloud.length===3&&cloud.at(-1).language==='eng','Language change reused stale recognition');
    $('ocrLanguage').value='kor+eng';await run([scan[0]]);assert(cloud.length===4&&cloud.at(-1).language==='kor+eng','Returning to Korean reused the latest English-only result');
    record('Current-page runs retain other results; provider and language changes select the right recognition');

    await reset();const failedBefore=cloud.length,failedRecords=ocrRecords;failOn=cloud.length+2;
    await run(scan);assert(cloud.length===failedBefore+2&&ocrRecords===failedRecords&&!ocrAccepted,'Partial failure replaced or accepted published results');
    failOn=0;await run(scan);assert(cloud.length===failedBefore+4&&records().length===3&&!ocrAccepted,'Resume did not reuse the completed first page');
    record('A second-page failure preserves published results; resume sends only unfinished pages');

    $('ocrAccept').click();const forcedRecords=ocrRecords,forcedBefore=cloud.length;failOn=cloud.length+2;
    await run(scan,true);assert(cloud.length===forcedBefore+2&&ocrRecords===forcedRecords&&ocrAccepted,'A failed forced run lost the previous accepted result');
    failOn=0;await run(scan);assert(cloud.length===forcedBefore+4&&records().length===3,'Forced retry resumed obsolete published results for unfinished pages');
    record('A forced batch discards old checkpoints; retry does not fall back to obsolete published results');

    await reset();await run([scan[2]]);$('ocrAccept').click();assert(ocrAccepted,'Prior result was not accepted');
    const acceptedRecords=ocrRecords,cancelBefore=cloud.length;holdOn=cloud.length+2;
    const pending=run(scan);await until(()=>cloud.length===holdOn,'Cancelable second request never started');
    $('busyCancel').click();await pending;await ready();
    assert(ocrRecords===acceptedRecords&&ocrAccepted,'Cancellation lost previous accepted results');
    holdOn=0;await run(scan);assert(cloud.length===cancelBefore+3&&records().length===3&&!ocrAccepted,'Resume lost a completed checkpoint or accepted new results');
    record('Cancel aborts the active page, retains accepted results, and resumes from completed checkpoints');

    let before=cloud.length;await run([scan[0]],true);assert(cloud.length===before+1,'Force recognition reused the cache');
    before=cloud.length;scan[0].rotation=90;await run([scan[0]]);assert(cloud.length===before+1,'Page rotation reused stale positions');
    scan[0].rotation=0;before=cloud.length;
    const whitePoint=$('proWhitePoint').value;$('proWhitePoint').value=String(Number(whitePoint)-1);
    await run([scan[0]]);assert(cloud.length===before+1,'Image correction reused stale recognition');
    assert(records().length===1&&!$('ocrAccept').disabled,'Stale results outside the current scope blocked acceptance of fresh recognition');
    $('proWhitePoint').value=whitePoint;
    record('Explicit retry, page rotation, and correction settings invalidate recognition as intended');
    record('Changed correction settings remove stale out-of-scope results without blocking fresh-page acceptance');

    await reset();await run([scan[0]],true);
    await showPreview(scan[0]);await ready();
    await openTextEditor({x:.15,y:.7});$('textInput').value='BASIC annotation once';
    await queueTextChange({text:$('textInput').value});finishTextEdit(true);await ready();
    before=cloud.length;await run([scan[0]],true);
    assert(cloud.length===before&&ocrRecords.find(r=>r.uid===scan[0].uid)?.skipped,'Searchable Basic text was sent again as image text');
    await createProResult();assert(proResult?.bytes,'Mixed scan/text export failed');
    const task=pdfjsLib.getDocument({data:proResult.bytes.slice(),...DOC_OPTS});
    try{
      const pdf=await task.promise,text=(await(await pdf.getPage(1)).getTextContent()).items.map(item=>item.str).join(' ');
      assert(!text.includes('Gemini scan recognition 12345'),'Outdated recognition was embedded after the page became searchable');
      assert(text.split('BASIC annotation once').length-1===1,'Basic text was lost or duplicated in export');
    }finally{await task.destroy();}
    record('Pages with searchable Basic text remain local, discard stale OCR, and export the annotation exactly once');

    await run([scan[1]]);
    const native=await PDFLib.PDFDocument.create();native.addPage([595,842]).drawText('Original searchable text',{x:40,y:740,size:18});
    await loadFiles([new File([await native.save()],'Native searchable.pdf',{type:'application/pdf'})]);await ready();
    before=cloud.length;await run([pages.at(-1)]);
    assert(cloud.length===before&&ocrRecords.find(r=>r.uid===pages.at(-1).uid)?.skipped,'Original searchable text was uploaded or duplicated');
    assert(records().includes(scan[1].uid),'Skipping a native page erased the recognized scan');
    record('Original searchable pages remain local and do not remove recognized scan results');

    await run([scan[1]]);$('ocrClear').click();before=cloud.length;await run([scan[1]]);
    assert(cloud.length===before+1,'Clearing recognition retained a hidden checkpoint');
    record('Clearing results also clears cached document recognition');
    report.textContent='PASS · '+checks.length+' Gemini flow checks\n'+checks.join('\n');
  }catch(error){report.textContent='FAIL · '+error.message+'\n'+checks.join('\n');console.error(error);}
  finally{PDFGemini.session=originalCloud;PDFOCR.session=originalLocal;PDFGemini.available=originalAvailable;}
})();
