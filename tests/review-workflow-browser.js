(async()=>{
 const out=$('reviewWorkflowReport'),checks=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)},record=m=>{checks.push(m);out.textContent=checks.join('\n');};
 const ready=async()=>{for(let i=0;i<600;i++){await wait(30);if(!reviewStampPending()&&$('proCompare').getAttribute('aria-busy')!=='true'){assert(!$('proCompare').hasAttribute('data-error'),'Preview failed');return;}}throw Error('Preview timeout');};
 const preset=async id=>{$('reviewStampPresets').querySelector(`[data-preset="${id}"]`).click();await ready();};
 const key=(target,key)=>target.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
 const images=async bytes=>{const pdf=await pdfjsLib.getDocument({data:bytes.slice(),...DOC_OPTS}).promise;try{const result=[];for(let i=1;i<=pdf.numPages;i++){const ops=await(await pdf.getPage(i)).getOperatorList();result.push(ops.fnArray.filter(x=>x===pdfjsLib.OPS.paintImageXObject).length);}return result;}finally{await pdf.destroy();}};
 try{
  await setProMode('basic');const doc=await PDFDocument.create();for(let i=1;i<=3;i++)doc.addPage([500,700]).drawText('SOURCE PAGE '+i,{x:35,y:650,size:16});await loadFiles([new File([await doc.save()],'Stamp workflow.pdf',{type:'application/pdf'})]);
  $('proOptimize').checked=false;$('proDeskew').checked=false;await setProMode('pro');await showPreview(pages[1]);await ready();
  await preset('revise');const page2=pages[1].uid;assert(currentStamp().targets[0]===page2,'Initial page not captured');
  await showPreview(pages[2]);await ready();assert(!stampAsset&&stampMarks.length===1&&stampMarks[0].targets[0]===page2,'Stamp followed navigation');assert(!stampPositioning,'Navigation left stamping cursor');
  record('Page 2 stamp stays on page 2; page navigation finishes placement');
  await showPreview(pages[1]);await preset('check');$('reviewStampMore').click();await ready();assert(stampMarks.length===2&&stampAsset,'Duplicate replaced the original');
  const width=currentStamp().width,labelBefore=$('reviewStampOverlay').querySelector('image').getAttribute('width');key($('reviewStampOverlay').querySelector('[data-review-handle="resize"]'),'ArrowRight');await ready();
  assert(currentStamp().width===width+1,'Resize keyboard failed');assert(Number($('reviewStampOverlay').querySelector('image').getAttribute('width'))>Number(labelBefore),'Label/text not scaled');
  key(document.body,'Enter');await ready();assert(stampMarks.length===3&&!stampAsset&&!stampPositioning,'Enter did not finish');record('Multiple placements, proportional label resize and Enter completion');
  await preset('typo');key(document.body,'Escape');await ready();assert(stampMarks.length===4&&!stampAsset&&!stampPositioning&&proPreviewOpen,'Esc deleted stamp or closed preview');
  await preset('formula');await preset('add');assert(stampMarks.length===5&&stampAsset.review.preset==='add','Choosing next preset overwrote previous stamp');key(document.body,'Enter');await ready();record('Esc keeps the stamp; changing preset adds a separate placement');
  assert(JSON.stringify(await images((await createProResult({reveal:false})).bytes))==='[0,6,0]','Exported page targeting/count differs');record('PDF contains six stamps on page 2 only');
  const originalPages=pages.slice();$('proWatermark').value='REVIEWED';$('proNumber').checked=true;
  const thumbnail=renderThumb;renderThumb=async()=>{throw Error('Injected thumbnail failure')};try{assert(await setProMode('basic')===false,'Failure switched mode');assert(pages[1]===originalPages[1]&&stampMarks.length===6&&proMode==='pro','Failure lost edits');}finally{renderThumb=thumbnail;}
  record('Failed Basic transfer keeps the complete Pro editing state');
  assert(await setProMode('basic'),'Basic transition failed');assert(proMode==='basic'&&stampMarks.length===0,'Effects left pending after Basic transfer');
  const saved=await(await buildEditedDocument()).save(),basicImages=await images(saved);assert(JSON.stringify(basicImages)==='[1,7,1]','Basic export lost/duplicated stamps: '+JSON.stringify(basicImages));
  const basicPdf=await pdfjsLib.getDocument({data:saved.slice(),...DOC_OPTS}).promise;try{const p=await basicPdf.getPage(2),t=(await p.getTextContent()).items.map(x=>x.str).join(' ');assert(t.includes('SOURCE PAGE 2')&&(await p.getTextContent()).items.some(x=>x.str==='2'),'Basic lost searchable text/watermark');}finally{await basicPdf.destroy();}
  record('Basic preview source and export include stamps, watermark and page numbers');
  await requestEditUndo();assert(proMode==='pro'&&pages[1]===originalPages[1]&&stampMarks.length===6&&$('proWatermark').value==='REVIEWED','Undo did not restore editable Pro state');
  await requestEditUndo(true);assert(proMode==='basic'&&stampMarks.length===0,'Redo failed');await setProMode('pro');await ready();assert(JSON.stringify(await images((await createProResult({reveal:false})).bytes))==='[1,7,1]','Round trip doubled stamps');
  record('Undo restores editable Pro settings; redo and repeated mode switches avoid duplicate effects');
  await showPreview(pages[0]);await preset('revise');
  out.textContent='PASS · '+checks.length+' checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e);}
})();
