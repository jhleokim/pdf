(async()=>{
 const out=document.createElement('output');out.id='appearanceReport';out.style='position:fixed;bottom:2px;left:8px;z-index:9999;background:white;color:black;font:11px monospace;white-space:pre-wrap;pointer-events:none';document.body.append(out);
 const checks=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)},record=m=>{checks.push(m);out.textContent=checks.join('\n');};
 const ready=async()=>{for(let n=0;n<400;n++){await wait(30);if(!reviewStampPending()&&$('proCompare').getAttribute('aria-busy')!=='true')return;}throw Error('Preview timeout');};
 const state=()=>JSON.stringify({pages:pages.map(p=>({uid:p.uid,doc:p.docId,index:p.srcIndex,rotation:p.rotation,annots:p.annots})),selection:selected().map(p=>p.uid),previewUid,mode:proMode,zoom:$('compareZoom').value,stamps:captureStampHistory().signature});
 const pixels=()=>[...document.querySelectorAll('canvas')].filter(c=>c.width&&c.height&&c.getBoundingClientRect().width).map(c=>c.toDataURL());
 async function combinations(){
  const before=state(),beforePixels=JSON.stringify(pixels()),show=showPreview,update=updateLivePreview;let renders=0;
  showPreview=(...args)=>{renders++;return show(...args);};updateLivePreview=(...args)=>{renders++;return update(...args);};
  try{
   $('btnTheme').click();assert($('appearanceDialog').open,'Appearance did not open');
   for(const style of ['studio','paper'])for(const mode of ['light','dark','auto']){
    document.querySelector(`[data-appearance="${style}"]`).click();document.querySelector(`[data-color-mode="${mode}"]`).click();await wait(80);
    assert(document.documentElement.dataset.appearance===style,'Style not applied');
    const resolved=mode==='auto'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode;
    assert(document.documentElement.dataset.theme===resolved,'Brightness not applied');
    assert(state()===before,'Theme changed the editing state');assert(JSON.stringify(pixels())===beforePixels,'Theme changed PDF pixels');
    const r=$('appearanceDialog').getBoundingClientRect();assert(r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,'Appearance panel exceeds viewport');
    if(innerWidth<=650)for(const b of document.querySelectorAll('.appearance-modes button'))assert(b.getBoundingClientRect().height>=44,'Mobile target too small');
   }
   $('appearanceClose').click();await wait(100);assert(document.activeElement===$('btnTheme'),'Focus not returned');assert(renders===0,'Theme caused '+renders+' document preview renders');
  }finally{showPreview=show;updateLivePreview=update;if($('appearanceDialog').open)$('appearanceDialog').close();}
  record(proMode+': six combinations preserve PDF pixels, editing state and focus; zero preview renders');
 }
 try{
  await setProMode('basic');const doc=await PDFDocument.create();
  for(const size of[[595,842],[842,595]]){const p=doc.addPage(size);p.drawText('PUBLIC DOCUMENT - THEME TEST',{x:30,y:size[1]-60,size:16});p.drawRectangle({x:50,y:120,width:180,height:90,color:PDFLib.rgb(.1,.4,.65)});}
  await loadFiles([new File([await doc.save()],'Theme test.pdf',{type:'application/pdf'})]);
  await showPreview(pages[0]);await wait(300);await combinations();
  $('proOptimize').checked=false;$('proDeskew').checked=false;await setProMode('pro');await showPreview(pages[0]);await ready();
  $('stampSection').open=true;document.querySelector('[data-preset="revise"]').click();await ready();await wait(300);
  assert(stampAsset.review.text==='수정','Default label not concise');assert(document.querySelectorAll('#reviewStampPresets>.review-stamp-preset').length===8,'Too many primary presets');
  assert(!PDFReviewStamp.presets.some(p=>/해주세요/.test(p.text)),'Long labels remain');
  await combinations();
  const mark=currentStamp(),box=PDFStamp.placement(mark,liveOutputSize.width,liveOutputSize.height),g=PDFReviewStamp.arrow(mark,box,liveOutputSize.width,liveOutputSize.height);
  assert(g.curves.length===1&&!PDFReviewStamp.path(g).curve.includes('C'),'Arrow is not a straight line');
  const result=await createProResult({reveal:false}),task=pdfjsLib.getDocument({data:result.bytes.slice(),...DOC_OPTS});
  try{const pdf=await task.promise;for(let i=1;i<=2;i++)assert((await(await pdf.getPage(i)).getTextContent()).items.some(x=>x.str.includes('PUBLIC DOCUMENT')),'Theme/stamp export lost text');}finally{await task.destroy();}
  record('Straight stamp arrow export preserves both pages and searchable source text');
  $('btnTheme').click();document.querySelector('[data-appearance="studio"]').click();document.querySelector('[data-color-mode="light"]').click();$('appearanceClose').click();
  out.textContent='PASS · '+checks.length+' checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e);}finally{if(parent!==window)parent.postMessage({appearanceReport:out.textContent},location.origin);}
})();
