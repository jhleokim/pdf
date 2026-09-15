(async()=>{
 const report=document.createElement('pre');report.id='privacySearchChecks';report.style='position:fixed;bottom:0;left:0;max-height:40vh;overflow:auto;z-index:99999;background:white;color:black;padding:12px;font:12px monospace';document.body.append(report);
 const lines=[],sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,text)=>{if(!v)throw Error(text);lines.push('PASS '+text);report.textContent=lines.join('\n');};
 async function confirmed(action){
  const pending=action();for(let n=0;n<200&&!$('documentCheckDialog').open;n++)await sleep(20);
  if($('documentCheckDialog').open){$('documentCheckAccept').checked=true;$('documentCheckAccept').dispatchEvent(new Event('change'));$('documentCheckContinue').click();}
  return pending;
 }
 async function inspect(bytes,provider){
  const task=pdfjsLib.getDocument({data:bytes.slice(),...DOC_OPTS});
  try{
   const pdf=await task.promise,contents=[];for(let n=1;n<=pdf.numPages;n++)contents.push((await(await pdf.getPage(n)).getTextContent()).items.filter(i=>i.str).map(i=>i.str).join(''));
   assert(contents[0].includes('123456')&&contents[0].includes('987654'),provider+' exported PDF searches both unmasked numbers');
   assert(!contents.join('').includes('998877')&&!contents.join('').includes('PRIVATE ACCOUNT'),provider+' masked text cannot be extracted');
   assert(contents[0].split('123456').length===2,provider+' no duplicated OCR layer');
   assert(contents[1].includes('공개 계약서')&&contents[1].includes('PUBLIC SECOND'),provider+' unmasked Korean and English text survive');
   const page=await pdf.getPage(1),vp=page.getViewport({scale:1}),canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
   assert(canvas.getContext('2d').getImageData(100,175,1,1).data[0]<20,provider+' saved mask pixels remain opaque');canvas.id='privacySearchResult';canvas.style='position:fixed;right:10px;bottom:10px;width:200px;z-index:99998;border:1px solid #aaa';document.getElementById(canvas.id)?.remove();document.body.append(canvas);
   const output=await PDFLib.PDFDocument.load(bytes),info=PDFDocumentIntegrity.inspect(output);assert(!info.attachments&&!info.forms&&output.getAuthor()!=='PRIVATE-AUTHOR',provider+' original forms, attachments and metadata are absent');
  }finally{await task.destroy();}
 }
 try{
  const scan=await PDFLib.PDFDocument.create(),p=scan.addPage([400,600]);
  p.drawText('PUBLIC 123456',{x:30,y:530,size:24});p.drawText('PRIVATE ACCOUNT 998877',{x:30,y:410,size:21});p.drawText('TOTAL 987654',{x:30,y:310,size:24});
  const scanTask=pdfjsLib.getDocument({data:await scan.save(),...DOC_OPTS}),scanPdf=await scanTask.promise,scanPage=await scanPdf.getPage(1),scanViewport=scanPage.getViewport({scale:2});
  const scanCanvas=document.createElement('canvas');scanCanvas.width=scanViewport.width;scanCanvas.height=scanViewport.height;await scanPage.render({canvasContext:scanCanvas.getContext('2d'),viewport:scanViewport}).promise;
  const doc=await PDFLib.PDFDocument.create(),scanImage=await doc.embedPng(await(await new Promise(r=>scanCanvas.toBlob(r,'image/png'))).arrayBuffer());doc.addPage([400,600]).drawImage(scanImage,{x:0,y:0,width:400,height:600});scanCanvas.width=scanCanvas.height=0;await scanTask.destroy();
  doc.setAuthor('PRIVATE-AUTHOR');await doc.attach(new TextEncoder().encode('PRIVATE ACCOUNT 998877'),'secret.txt');
  const fontData=await PDFMarkupText.load();doc.registerFontkit(fontkit);const font=await doc.embedFont(fontData.bytes,{subset:true});
  const p2=doc.addPage([400,600]);p2.drawText('공개 계약서 PUBLIC SECOND',{x:30,y:520,size:18,font});
  await loadFiles([new File([await doc.save()],'privacy-search-fixture.pdf',{type:'application/pdf'})]);await setProMode('pro');
  $('proOptimize').checked=false;$('proDeskew').checked=false;refreshProControls();
  const first=pages[0];first.annots=[{id:'qa-mask',shape:'redaction',nx:.05,ny:.27,nw:.9,nh:.09,fill:'#000000',stroke:'none',opacity:1,lineWidth:0}];proInvalidate();
  for(const provider of ['paddle-v5','tesseract']){
   $('ocrProvider').value=provider;configureLocalOCR();report.textContent=lines.join('\n')+'\nRunning real '+provider+' on the masked digital page…';
   await runOCR(false,provider,[first]);const r=ocrRecords.find(r=>r.uid===first.uid&&r.source===provider);
   assert(!!r&&!r.skipped,provider+' recognizes masked scan page');
   assert(r.text.includes('123456')&&r.text.includes('987654')&&!r.text.includes('998877'),provider+' reads public content only from masked pixels');
   assert(r.privacyKey===PDFPrivacy.maskKey(first),provider+' OCR tied to current mask');
   $('ocrAccept').click();assert(ocrAccepted,provider+' accepts reviewed searchable text');
   const saved=await confirmed(()=>createProResult({reveal:false}));assert(!!saved?.bytes,provider+' Pro save succeeds');await inspect(saved.bytes,provider);
   assert($('proReport').textContent.includes('검색·복사 가능 2페이지'),provider+' report confirms two searchable pages');
   first.annots[0].nx+=.01;let stale=false;try{readProOptions(true);}catch(e){stale=e.message.includes('다시 인식');}assert(stale,provider+' moving a mask invalidates accepted OCR');first.annots[0].nx-=.01;
  }
  const r=ocrRecords[0],beforeKey=r.privacyKey;delete r.privacyKey;assert(!ocrRecordCurrent(r,first,readProOptions()),'Legacy cached masked OCR is refused');r.privacyKey=beforeKey;
  const moved={...r,privacyKey:'old-mask'};const blocked=await finalizePrivateExport(await buildEditedDocument(),pages,{ocr:[moved]});
  const blockedTask=pdfjsLib.getDocument({data:await blocked.save(),...DOC_OPTS});try{const pdf=await blockedTask.promise;assert((await(await pdf.getPage(1)).getTextContent()).items.length===0,'Final exporter refuses OCR from another mask');assert((await(await pdf.getPage(2)).getTextContent()).items.some(i=>i.str.includes('PUBLIC SECOND')),'Native unmasked text survives even without accepted OCR');}finally{await blockedTask.destroy();}
  const index=r.words.findIndex(w=>w.text.includes('123456'));assert(index>=0,'Editable OCR number has coordinates');r.correctionLines=[{indices:[index],box:r.words[index].box.slice(),text:'교정완료 123456'}];proInvalidate();
  const corrected=await confirmed(()=>createProResult({reveal:false}));const ct=pdfjsLib.getDocument({data:corrected.bytes.slice(),...DOC_OPTS});try{const pdf=await ct.promise,text=(await(await pdf.getPage(1)).getTextContent()).items.map(i=>i.str).join('');assert(text.includes('교정완료 123456'),'Korean line corrections survive private export');}finally{await ct.destroy();}
  assert(await confirmed(()=>setProMode('basic')),'Pro to Basic transfer succeeds');
  await inspect(await(await buildEditedDocument()).save(),'Basic after Pro transfer');
  report.textContent=lines.join('\n')+'\nALL PASSED';document.body.dataset.privacySearchQA='passed';
 }catch(e){report.textContent=lines.join('\n')+'\nFAIL '+e.stack;document.body.dataset.privacySearchQA='failed';console.error(e);}
})();
