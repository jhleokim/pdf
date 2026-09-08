(async()=>{
  const report=$('ocrUITest'),checks=[],assert=(v,m)=>{if(!v)throw Error(m);},record=m=>{checks.push(m);report.textContent=checks.join('\n');};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  async function ready(){for(let i=0;i<600;i++){if(!ocrRunning&&!proAbort&&$('proCompare').getAttribute('aria-busy')!=='true')return;await wait(50);}throw Error('UI did not become ready');}
  const originalFetch=window.fetch,originalSession=PDFOCR.session;let posts=0,gets=0,available=true,hold=false,localCalls=0,body;
  const output={lines:[{text:'계약 금액 123,450원',box:[100,100,145,700],uncertain:false},{text:'PDF Studio test',box:[200,100,245,700],uncertain:true}],model:'test-model'};
  window.fetch=async(url,init={})=>{
    if(!String(url).includes('/api/ocr/gemini'))return originalFetch(url,init);
    if(init.method!=='POST'){gets++;return Response.json({available});}
    posts++;body=JSON.parse(init.body);
    if(hold)return new Promise((_,reject)=>{init.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});});
    return Response.json(output);
  };
  PDFOCR.session=async()=>({close:async()=>{},recognize:async()=>{localCalls++;return {text:'로컬 테스트 123',words:[{text:'로컬 테스트 123',box:[.1,.1,.7,.15],confidence:90,separator:'\n'}],confidence:90};}});
  try{
    await loadFiles([new File([b64bytes(TEST_SCAN)],'Synthetic OCR.pdf',{type:'application/pdf'})]);await ready();
    for(let i=0;i<7;i++)$('modePro').click();
    assert($('geminiTools').hidden,'Gemini appeared before eight clicks');assert(gets===0&&posts===0,'Opening Pro sent a request');
    $('modePro').click();assert(!$('geminiTools').hidden,'Eighth click did not reveal Gemini');assert(gets===0&&posts===0,'Unlock sent a request');record('Eight clicks reveal Gemini without network traffic');
    showPreview(pages[0]);await ready();await runOCR(true);assert(localCalls===1&&posts===0,'Local OCR sent a cloud request');
    await runOCR(true);assert(localCalls===1&&$('ocrStatus').textContent.includes('재사용'),'Unchanged OCR was not reused');
    $('ocrLayout').value='6';await runOCR(true);assert(localCalls===2,'Layout change reused stale OCR');record('Local result reuse respects language/layout and never uploads');
    await runOCR(false,'gemini');assert(posts===0,'Gemini ran without consent');
    await $('geminiRun').onclick();assert($('geminiDialog').open&&!$('geminiConsent').checked&&$('geminiConfirm').disabled,'Consent not initially required');
    $('geminiConfirm').click();assert(posts===0,'Unchecked consent sent a page');record('Unchecked confirmation blocks document transmission');
    $('geminiConsent').checked=true;$('geminiConsent').dispatchEvent(new Event('change'));assert(!$('geminiConfirm').disabled,'Consent did not enable action');
    $('geminiDialog').close();await wait(50);await $('geminiRun').onclick();assert(!$('geminiConsent').checked&&$('geminiConfirm').disabled,'Consent persisted after reopening');
    $('geminiConsent').checked=true;$('geminiConsent').dispatchEvent(new Event('change'));$('geminiConfirm').click();await ready();
    assert(posts===1&&body.consent===true&&body.mimeType==='image/jpeg','Wrong upload scope or consent');
    assert(ocrRecords[0].source==='gemini'&&ocrRecords[0].text.includes('123,450')&&!ocrAccepted,'Gemini result missing or auto-accepted');
    assert($('ocrConfidence').textContent.includes('추정 위치')&&!$('ocrConfidence').textContent.includes('/ 100'),'Fake confidence shown');
    $('ocrAccept').click();await createProResult();assert(proResult,'Gemini PDF export failed');
    const pdf=await pdfjsLib.getDocument({data:proResult.bytes.slice(),...DOC_OPTS}).promise;
    const text=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str).join('');await pdf.destroy();assert(text.includes('123,450'),'Gemini PDF not searchable');record('Explicit consent uploads one page; accepted result exports searchable text');
    const previous=ocrRecords;hold=true;await $('geminiRun').onclick();$('geminiConsent').checked=true;$('geminiConsent').dispatchEvent(new Event('change'));$('geminiConfirm').click();
    for(let i=0;i<200&&posts<2;i++)await wait(50);assert(posts===2,'Pending request not reached');$('busyCancel').click();await ready();hold=false;
    assert(ocrRecords===previous&&!proAbort,'Cancellation lost accepted results or locked UI');record('Cancellation aborts request and preserves previous results');
    available=false;await $('geminiRun').onclick();$('geminiConsent').checked=true;$('geminiConsent').dispatchEvent(new Event('change'));assert($('geminiConfirm').disabled,'Missing server secret permits upload');$('geminiDialog').close();await wait(50);record('Missing API key blocks upload with a clear message');
    available=true;await $('geminiRun').onclick();$('geminiConsent').checked=true;$('geminiConsent').dispatchEvent(new Event('change'));pages[0].rotation=90;$('geminiConfirm').click();await wait(50);assert(posts===2,'Changed document reused old consent');record('Document changes invalidate pending consent');
    report.textContent='PASS · '+checks.length+' OCR UI checks\n'+checks.join('\n');
  }catch(e){report.textContent='FAIL · '+e.message+'\n'+checks.join('\n');console.error(e);}
  finally{window.fetch=originalFetch;PDFOCR.session=originalSession;}
})();
