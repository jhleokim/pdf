(async()=>{
 const out=$('printChecks'),checks=[],assert=(v,m)=>{if(!v)throw Error(m)},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const record=m=>{checks.push(m);out.textContent=checks.join('\n')};
 const until=async(fn)=>{for(let i=0;i<500;i++){if(fn())return;await wait(30);}throw Error('Timed out')};
 const pdfRows=async bytes=>{const pdf=await pdfjsLib.getDocument({data:bytes.slice(),...DOC_OPTS}).promise;try{const rows=[];for(let i=1;i<=pdf.numPages;i++)rows.push((await(await pdf.getPage(i)).getTextContent()).items.map(x=>x.str).join(' '));return rows;}finally{await pdf.destroy();}};
 const bytes=async()=>new Uint8Array(await(await fetch(printJob.url)).arrayBuffer());
 const actualPrint=invokeDocumentPrint,capability=supportsPdfPrinting,download=downloadPdf,mount=mountPrintDocument;let prints=0,downloads=0;
 // The embedded test browser cannot initialize its native PDF-viewer plugin.
 // Simulate that plugin's load notification and intercept the print bridge;
 // parse the real, unmodified PDF bytes below. Never send a hardware print job.
 mountPrintDocument=job=>{mount(job);if(job.frame)job.frame.onload?.();};
 invokeDocumentPrint=frame=>{assert(frame===printJob.frame&&frame.src===printJob.url&&frame.src.startsWith('blob:'),'Printed the editor instead of the PDF');prints++;};
 downloadPdf=()=>downloads++;supportsPdfPrinting=()=>true;
 try{
  setProMode('basic');assert($('btnPrint').disabled&&$('mbPrint').disabled,'Print enabled without pages');
  assert($('btnSave').previousElementSibling===$('btnPrint')&&$('mbSave').previousElementSibling===$('mbPrint'),'Printer icon is not immediately before Save');
  assert($('btnPrint').querySelector('use').getAttribute('href')==='#i-printer','Wrong printer icon');record('Disabled printer icons sit immediately before desktop and mobile Save');
  const doc=await PDFDocument.create();doc.addPage([400,600]).drawText('PRINT ORIGINAL',{x:30,y:550,size:18});doc.addPage([600,400]).drawText('LANDSCAPE',{x:30,y:350,size:18});
  await loadFiles([new File([await doc.save()],'Printer test.pdf',{type:'application/pdf'})]);const first=pages[0];if(isMobile())setMobileView('preview');await showPreview(first);await openTextEditor({x:.12,y:.2});
  $('textInput').value='인쇄 편집 ABC';const update=queueTextChange({text:$('textInput').value,color:'#cc0000'}),printing=printCurrentDocument();await Promise.all([update,printing]);await until(()=>prints===1);
  let data=await bytes(),rows=await pdfRows(data),saved=await PDFDocument.load(data);
  assert(rows.length===2&&rows[0].includes('인쇄 편집 ABC')&&rows[1].includes('LANDSCAPE'),'Basic print omitted pending text or pages');
  assert(saved.getPage(0).getWidth()===400&&saved.getPage(1).getWidth()===600,'Printing changed page sizes/orientations');
  assert(!downloads&&!$('basicSaveDialog').open,'Print required downloading first');record('One click prints all edited pages, waits for text and retains mixed page sizes');
  const url=printJob.url;printPreparedDocument();assert(prints===2&&printJob.url===url,'Retry rebuilt the PDF');
  closePrintDialog();assert(!$('printDialog').open&&printJob.url===url,'Closing discarded an active print source');record('Retry reuses prepared bytes; closing the print panel preserves its source');
  const layout=relayoutText;await openTextEditor(null,first.annots[0]);let release;const gate=new Promise(r=>release=r);relayoutText=async a=>{await gate;return layout(a)};
  try{$('textInput').value='마지막 입력';const pending=queueTextChange({text:$('textInput').value}),a=printCurrentDocument(),b=printCurrentDocument();release();await Promise.all([pending,a,b]);await until(()=>prints===3);}finally{release?.();relayoutText=layout;}
  assert((await pdfRows(await bytes()))[0].includes('마지막 입력'),'Delayed text was omitted');assert(document.querySelectorAll('.pdf-print-frame').length===1,'Duplicate print frames');record('Repeated clicks during delayed text create only one up-to-date print job');
  closePrintDialog();$('proOptimize').checked=false;$('proNumber').checked=true;$('proStartNumber').value='7';setProMode('pro');
  await printCurrentDocument();await until(()=>prints===4);data=await bytes();rows=await pdfRows(data);
  assert(rows[0].includes('7')&&rows[1].includes('8')&&proResult,'Pro printing omitted page numbers');assert(data.length===proResult.bytes.length&&data.every((v,i)=>v===proResult.bytes[i]),'Printed bytes differ from the downloadable Pro result');record('Pro printing prepares the current settings and uses the exact verified export PDF');
  closePrintDialog();const create=createProResult;createProResult=()=>{throw Error('A prepared Pro result should be reused')};try{await printCurrentDocument();await until(()=>prints===5);}finally{createProResult=create;}record('Printing an unchanged Pro result reuses the prepared PDF');
  closePrintDialog();$('proStartNumber').value='11';$('proStartNumber').dispatchEvent(new Event('input',{bubbles:true}));await printCurrentDocument();await until(()=>prints===6);assert((await pdfRows(await bytes()))[0].includes('11'),'Printed stale Pro settings');record('Changing Pro settings invalidates the previous print source');
  closePrintDialog();supportsPdfPrinting=()=>false;await printCurrentDocument();assert(printJob.phase==='fallback'&&!printJob.frame&&$('printRetry').disabled&&$('printOpenPdf').href===printJob.url,'Unsupported browser has no PDF fallback');assert(prints===6&&!downloads,'Unsupported browser auto-printed or downloaded');record('Browsers without inline PDF printing get a user-controlled PDF link');
  const r=$('printDialog').getBoundingClientRect();assert(r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,'Print dialog leaves the viewport');const open=$('printOpenPdf').getBoundingClientRect();assert(open.height>=36,'PDF fallback is not touch accessible');record('Print controls fit the viewport and remain accessible');
  closePrintDialog();supportsPdfPrinting=()=>true;invokeDocumentPrint=()=>{throw new DOMException('Blocked','SecurityError')};await printCurrentDocument();await until(()=>printJob?.phase==='fallback');assert($('printStatus').textContent.includes('직접 열지 못했습니다')&&$('printOpenPdf').href.startsWith('blob:'),'Blocked print has no recovery');record('A blocked print bridge keeps the prepared PDF available');
  closePrintDialog();setProMode('basic');const build=buildEditedDocument;let releaseBuild,entered;const gateBuild=new Promise(r=>releaseBuild=r),started=new Promise(r=>entered=r);
  buildEditedDocument=async(...args)=>{entered();await gateBuild;return build(...args)};
  try{const pending=printCurrentDocument();await started;$('busyCancel').click();releaseBuild();await pending;assert(!printJob&&!$('printDialog').open&&!document.body.classList.contains('is-busy'),'Canceled preparation opened a print dialog');}finally{releaseBuild?.();buildEditedDocument=build;}record('Canceling PDF preparation restores editing without printing');
  invokeDocumentPrint=frame=>{assert(frame===printJob.frame,'Wrong frame');prints++;};
  const before=prints;document.dispatchEvent(new KeyboardEvent('keydown',{key:'p',ctrlKey:true,bubbles:true,cancelable:true}));await until(()=>prints===before+1);record('Ctrl+P uses the edited PDF instead of printing the application interface');
  closePrintDialog();releasePrintJob();assert(!document.querySelector('.pdf-print-frame')&&!$('printOpenPdf').hasAttribute('href'),'Print resources were not released');record('Cleanup releases the retained frame and local PDF URL');
  const network=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name)&&new URL(e.name).origin!==location.origin);assert(!network.length,'Printing contacted an external server');
  out.textContent='PASS · '+checks.length+' print checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e)}finally{closePrintDialog();releasePrintJob();invokeDocumentPrint=actualPrint;supportsPdfPrinting=capability;downloadPdf=download;mountPrintDocument=mount;if(parent!==window)parent.postMessage({printReport:out.textContent},location.origin)}
})();
