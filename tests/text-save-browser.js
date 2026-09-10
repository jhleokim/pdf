(async()=>{
 const out=$('textSaveChecks'),checks=[],assert=(value,message)=>{if(!value)throw Error(message)},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const record=message=>{checks.push(message);out.textContent=checks.join('\n')};
 const download=downloadPdf,build=buildEditedDocument,downloads=[];
 downloadPdf=(bytes,name)=>downloads.push({bytes,name});
 try{
  setProMode('basic');await insertBlankPage();await insertBlankPage();await showPreview(pages[0]);if(innerWidth<=880){setMobileView('preview');await showPreview(pages[0]);}
  await openTextEditor({x:.12,y:.18});
  assert($('pvStage').contains($('textInput'))&&$('annoBar').contains($('textFont'))&&$('textApply').disabled,'Inline draft/toolbar controls');
  $('textInput').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));$('textInput').value='회의 자료\n검토 완료';await queueTextChange({text:$('textInput').value});
  assert($('textApply').disabled&&!finishTextEdit(true),'Composition committed before completion');
  $('textInput').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await textUpdate;
  assert(!$('textApply').disabled&&$('textInput').value==='회의 자료\n검토 완료','Composition completion');
  await applyTextEditor();const text=textSelection();assert(text?.text.includes('검토 완료')&&$('textEditor').hidden&&$('textPropertiesHome').contains($('textFont')),'Applying draft lost text/controls');record('Korean composition, explicit application and format controls');
  await openTextEditor(null,text);$('textSizeNumber').focus();$('textSizeNumber').value='';$('textSizeNumber').dispatchEvent(new Event('input'));assert($('textSizeNumber').value===''&&text.fontSize===14,'Number input overwrote partial typing');
  $('textSizeNumber').value='24';$('textSizeNumber').dispatchEvent(new Event('input'));await textUpdate;assert(text.fontSize===24,'Numeric font size');
  await queueTextChange({text:'취소할 내용',font:'myeongjo'});finishTextEdit(false);assert(text.text==='회의 자료\n검토 완료'&&text.fontSize===14&&text.font==='gothic','Cancel lost the prior text or formatting');record('Font size can be typed naturally; cancel restores text and style');
  await openTextEditor(null,text);await queueTextChange({text:'검토 😀'});assert($('textApply').disabled&&$('textInput').getAttribute('aria-invalid')==='true','Invalid text can be applied');finishTextEdit(false);
  await openTextEditor(null,text);await wait(60);positionTextEditor();const panel=$('textEditor').getBoundingClientRect(),button=$('textApply').getBoundingClientRect(),page=$('pvCanvas').getBoundingClientRect();
  assert(Math.abs(panel.left-(page.left+text.nx*page.width-3))<2&&button.bottom<=innerHeight+1,'Inline text is detached from page or apply action clipped');
  $('textFormatDetails').open=true;await wait(80);assert($('textApply').getBoundingClientRect().bottom<=innerHeight+1,'Format controls hide the apply action');finishTextEdit(false);record('Text stays at its page position; formatting and apply remain in the toolbar');
  await save();let state=basicSaveState;assert($('basicSaveDialog').open&&state.phase==='ready'&&downloads.length===0,'Save must prepare without automatically downloading');
  $('basicSaveFilename').value='문서 검토.pdf';$('basicSaveFilename').dispatchEvent(new Event('input'));downloadBasicSave();downloadBasicSave();
  assert(downloads.length===2&&downloads[0].name==='문서 검토.pdf'&&downloads[0].bytes===downloads[1].bytes,'Named/repeated download changed bytes or extension');
  const pdf=await pdfjsLib.getDocument({data:downloads[0].bytes.slice(),...DOC_OPTS}).promise;assert(pdf.numPages===2,'Export page count');
  const textContent=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str).join(' ');assert(textContent.includes('회의 자료')&&textContent.includes('검토 완료'),'Saved Korean text is not searchable');await pdf.destroy();
  assert($('basicSaveStatus').textContent==='다운로드를 시작했습니다','Download feedback claims disk completion');record('Named downloads reuse prepared bytes and preserve searchable Korean text');
  $('basicSaveFilename').value=' ';$('basicSaveFilename').dispatchEvent(new Event('input'));assert($('basicSaveDownload').disabled&&$('basicFilenameError').textContent,'Empty filename allowed');
  assert(pdfFilename('A/B:test.pdf')==='A_B_test'&&pdfFilename('CON')==='_CON','Invalid/reserved filename');closeBasicSaveDialog();assert(!basicSaveState&&state.controller.signal.aborted,'Closing save retained active state');record('Filename validation and close release the prepared result');
  let release,entered=0;const gate=new Promise(r=>release=r);
  buildEditedDocument=async(...args)=>{if(++entered===1)await gate;return build(...args)};
  const canceled=save();for(let i=0;i<50&&!basicSaveState;i++)await wait(10);const canceledState=basicSaveState;closeBasicSaveDialog();const replacement=save();release();await Promise.all([canceled,replacement]);await wait(30);
  assert(basicSaveState&&basicSaveState!==canceledState&&basicSaveState.phase==='ready'&&!canceledState.bytes,'Canceled preparation replaced/closed the newer save');buildEditedDocument=build;closeBasicSaveDialog();record('Cancel and immediate reopen reject stale preparation');
  let fail=true;buildEditedDocument=(...args)=>{if(fail){fail=false;throw Error('시험용 저장 실패')}return build(...args)};
  const log=console.error;console.error=()=>{};try{await save()}finally{console.error=log}
  assert(basicSaveState.phase==='error'&&!$('basicSaveDownload').disabled,'Failure cannot be retried');await downloadBasicSave();assert(basicSaveState.phase==='ready','Retry did not recover');buildEditedDocument=build;closeBasicSaveDialog();record('Preparation errors retain the document and can be retried');
  await showPreview(pages[0]);await openTextEditor(null,pages[0].annots[0]);$('textInput').value='단축키로 저장';await queueTextChange({text:$('textInput').value});
  const event=new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true});$('textInput').dispatchEvent(event);
  for(let i=0;i<200&&(!basicSaveState||basicSaveState.phase==='preparing');i++)await wait(20);
  assert(event.defaultPrevented&&basicSaveState?.phase==='ready'&&$('textEditor').hidden,'Ctrl+S in text input saves HTML or loses draft');closeBasicSaveDialog();record('Ctrl+S from the text input applies the draft and opens PDF save');
  const external=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name)&&new URL(e.name).origin!==location.origin);assert(!external.length,'External font or service request');record('Text and saving work with external HTTP connections blocked');
  out.textContent='PASS · '+checks.length+' text/save checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e)}finally{downloadPdf=download;buildEditedDocument=build;if(parent!==window)parent.postMessage({textSaveReport:out.textContent},location.origin)}
})();
