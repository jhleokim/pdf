(async()=>{
 const output=document.createElement('pre');output.id='selectedSaveChecks';output.style='position:fixed;bottom:0;left:0;z-index:99999;background:white;color:black;max-height:25vh;overflow:auto;font:11px monospace';document.body.append(output);
 const lines=[],assert=(v,m)=>{if(!v)throw Error(m);},record=m=>{lines.push(m);output.textContent=lines.join('\n');},sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const originalDownload=downloadPdf,originalBuild=buildEditedDocument,downloads=[];downloadPdf=(bytes,name)=>downloads.push({bytes,name});
 const choose=indices=>{pages.forEach((p,i)=>p.el.classList.toggle('selected',indices.includes(i)));syncCounts();};
 async function texts(bytes){const task=pdfjsLib.getDocument({data:bytes.slice(),...DOC_OPTS});try{const pdf=await task.promise,result=[];for(let n=1;n<=pdf.numPages;n++)result.push((await(await pdf.getPage(n)).getTextContent()).items.map(i=>i.str).join(' '));return result;}finally{await task.destroy();}}
 async function confirmed(fn){const timer=setInterval(()=>{if($('documentCheckDialog').open){$('documentCheckAccept').checked=true;$('documentCheckAccept').dispatchEvent(new Event('change'));$('documentCheckContinue').click();}},20);try{return await fn();}finally{clearInterval(timer);}}
 try{
  await setProMode('basic');const doc=await PDFLib.PDFDocument.create();
  for(let i=1;i<=5;i++){const p=doc.addPage([400,600]);p.drawText('SOURCE-'+i,{x:35,y:530,size:24});p.drawText('SECRET-'+i,{x:35,y:410,size:24});}
  await loadFiles([new File([await doc.save()],'Selected pages.pdf',{type:'application/pdf'})]);choose([1,4]);
  await save();assert(basicSaveState.phase==='ready'&&basicSaveState.pages.length===5,'Default full export');
  $('basicSaveSelected').click();await basicSaveState.pending;
  const selectedBytes=basicSaveState.bytes;assert(basicSaveState.phase==='ready'&&basicSaveState.pages.length===2,'Selected scope ready');
  const subset=await texts(selectedBytes);assert(subset.length===2&&subset[0].includes('SOURCE-2')&&subset[1].includes('SOURCE-5')&&!subset.join('').includes('SOURCE-1'),'Wrong selected pages/order');
  assert($('basicSavePages').textContent.startsWith('2, 5쪽'),'Visible range');downloadBasicSave();downloadBasicSave();assert(downloads.length===2&&downloads[0].bytes===downloads[1].bytes,'Repeat download did not reuse bytes');
  record('Basic: noncontiguous pages 2 and 5 only, current order, searchable text and repeat download');closeBasicSaveDialog();
  choose([]);await save();assert($('basicSaveSelected').disabled,'No selection must be disabled');await changeBasicSaveScope('selected');assert(!basicSaveState.bytes&&$('basicSaveDownload').disabled,'Empty selection fell back to whole document');closeBasicSaveDialog();record('Empty selection never exports all pages accidentally');
  choose([1,4]);let release;const gate=new Promise(r=>release=r);let first=true;
  buildEditedDocument=async(...args)=>{if(first){first=false;await gate;}return originalBuild(...args);};
  const preparing=save();for(let i=0;i<100&&first;i++)await sleep(10);const obsolete=basicSaveState;
  const switched=changeBasicSaveScope('selected');release();await Promise.all([preparing,switched]);buildEditedDocument=originalBuild;
  assert(!obsolete.bytes&&basicSaveState.pages.length===2&&(await texts(basicSaveState.bytes)).length===2,'Canceled full document replaced selected result');closeBasicSaveDialog();record('Switching during preparation cancels the previous export without stale bytes');
  // Reorder the document: selection follows the page cards, output follows UI order.
  [pages[1],pages[4]]=[pages[4],pages[1]];render();choose([1,4]);await save();await changeBasicSaveScope('selected');
  const reordered=await texts(basicSaveState.bytes);assert(reordered[0].includes('SOURCE-5')&&reordered[1].includes('SOURCE-2'),'Export ignored reordered document');closeBasicSaveDialog();record('Selection and exported order follow reordered page cards');
  await setProMode('pro');$('proNumber').checked=true;$('proStartNumber').value='10';$('proSkipPages').value='1';pages[4].deskewAngle=0;refreshProControls();
  const o=readProOptions();ocrRecords=pages.map((p,i)=>({uid:p.uid,key:ocrKey(p,o),source:'tesseract',text:'OCR-'+(i+1),words:[{text:'OCR-'+(i+1),box:[.1,.65,.35,.7]}]}));ocrAccepted=true;
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
  stampMarks=[{data:png,scope:'selected',targets:[pages[4].uid,pages[2].uid],anchor:'bottom-right',width:20,ratio:1,x:10,y:10,opacity:1}];proInvalidate();
  const full=await createProResult({reveal:false});assert(full?.bytes&&(await texts(full.bytes)).length===5,'Full Pro baseline');
  await proPrimaryAction();await changeBasicSaveScope('selected');assert(basicSaveState.phase==='ready','Pro selected save failed: '+$('basicSaveError').textContent);
  const proTexts=await texts(basicSaveState.bytes);assert(proTexts.length===2&&proTexts[0].includes('OCR-2')&&proTexts[1].includes('OCR-5')&&!proTexts.join('').includes('OCR-3'),'OCR mapped to wrong selected page');
  assert(/\b10\b/.test(proTexts[0])&&/\b13\b/.test(proTexts[1]),'Page numbering no longer matches preview');
  const exported=await PDFLib.PDFDocument.load(basicSaveState.bytes),imageCount=p=>[...p.node.Resources().lookup(PDFLib.PDFName.of('XObject'),PDFLib.PDFDict)?.entries()||[]].length;
  assert(imageCount(exported.getPage(0))===0&&imageCount(exported.getPage(1))===1,'Stamp targets changed in subset');assert(proResult===full&&(await texts(proResult.bytes)).length===5,'Subset contaminated print/transfer cache');
  closeBasicSaveDialog();record('Pro: OCR/stamp IDs and original numbering preserved; full-document cache stays separate');
  // An obsolete OCR result on an excluded page must not block selected export.
  ocrRecords[0].key='stale';proInvalidate();const log=console.error;console.error=()=>{};try{await save();}finally{console.error=log;}
  assert(basicSaveState.phase==='error','Whole-document stale OCR should fail');await changeBasicSaveScope('selected');assert(basicSaveState.phase==='ready','Unselected stale OCR blocked selected save');closeBasicSaveDialog();record('Only exported pages are checked for stale OCR');
  ocrRecords=[];ocrAccepted=false;stampMarks=[];pages[4].annots=[{id:'mask-selected',shape:'redaction',nx:.05,ny:.27,nw:.7,nh:.09,fill:'#000000',stroke:'none',opacity:1,lineWidth:0}];proInvalidate();
  await confirmed(()=>save());await confirmed(()=>changeBasicSaveScope('selected'));assert(basicSaveState.phase==='ready','Selected redaction failed: '+$('basicSaveError').textContent);
  const privateText=await texts(basicSaveState.bytes);assert(privateText.length===2&&privateText[1].includes('SOURCE-2')&&!privateText[1].includes('SECRET-2')&&privateText[0].includes('SECRET-5'),'Selected redaction removed wrong text');
  record('Selected redaction removes only masked content and keeps other text searchable');
  const bounds=$('basicSaveDialog').getBoundingClientRect(),downloadBounds=$('basicSaveDownload').getBoundingClientRect();assert(bounds.left>=0&&bounds.right<=innerWidth+1&&downloadBounds.bottom<=innerHeight+1,'Save controls clipped');
  record('Save scope controls and download fit the viewport');
  assert(!performance.getEntriesByType('resource').some(r=>/^https?:/.test(r.name)&&new URL(r.name).origin!==location.origin),'Unexpected external request');record('No external document/service request');
  output.textContent='PASS · '+lines.length+' selected-save checks\n'+lines.join('\n');
 }catch(e){output.textContent=lines.join('\n')+'\nFAIL '+e.stack;console.error(e);}finally{downloadPdf=originalDownload;buildEditedDocument=originalBuild;if(parent!==window)parent.postMessage({selectedSaveReport:output.textContent},'*');}
})();
