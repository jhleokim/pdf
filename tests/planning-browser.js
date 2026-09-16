/* Integration checks run as app-owned test code in web and offline builds. */
(async()=>{
 const out=document.createElement('pre');out.id='planningChecks';out.style='position:fixed;bottom:0;left:0;max-height:26vh;max-width:65vw;overflow:auto;z-index:99999;background:white;color:black;padding:10px;font:11px monospace';document.body.append(out);
 const lines=[],sleep=ms=>new Promise(r=>setTimeout(r,ms)),check=(ok,label)=>{if(!ok)throw Error(label);lines.push('PASS '+label);report('');};
 const report=tail=>{out.textContent=lines.join('\n')+'\n'+tail;if(parent!==self)parent.postMessage({planningQA:out.textContent},'*');};
 const fonts=()=>performance.getEntriesByType('resource').filter(e=>e.name.includes('/markup/'));
 async function text(bytes){const d=await pdfjsLib.getDocument({data:bytes.slice(),...DOC_OPTS}).promise;try{const rows=[];for(let n=1;n<=d.numPages;n++)rows.push((await(await d.getPage(n)).getTextContent()).items.map(t=>t.str).join(' '));return rows;}finally{await d.destroy();}}
 async function waitPreview(){for(let i=0;i<300;i++){await sleep(30);if($('compareState').textContent==='미리보기 업데이트 완료'&&$('proCompare').getAttribute('aria-busy')!=='true')return;if($('proCompare').dataset.error==='true')throw Error($('compareNote').textContent);}throw Error('Preview timeout');}
 try{
  check(!fonts().length,'No font request on startup');await setProMode('basic');
  const first=await PDFDocument.create();first.addPage([400,600]).drawText('SOURCE ONE',{x:35,y:550,size:18});first.addPage([600,400]).drawText('SOURCE TWO',{x:35,y:340,size:18});
  const second=await PDFDocument.create();second.addPage([400,600]).drawText('ATTACHMENT',{x:35,y:550,size:18});
  await loadFiles([new File([await first.save()],'계약서.pdf',{type:'application/pdf'})]);check($('proFilename').value==='계약서_편집본','Single PDF uses original-based output name');
  await loadFiles([new File([await second.save()],'첨부.pdf',{type:'application/pdf'})]);check($('proFilename').value==='통합_편집본','Multiple sources suggest merged output name');
  const originals=pages.map(p=>PDFSource.page(p,docs));$('proFilename').value='사용자 지정 계약서';$('proFilename').dispatchEvent(new Event('input'));
  await setProMode('pro');check(!$('proOptimize').checked&&!$('proDeskew').checked&&!$('proGrayscale').checked,'Entering Pro enables no correction');
  $('proNumber').checked=true;$('proStartNumber').value='7';refreshProControls();
  await setProMode('basic');check(proMode==='basic','Pro edits transfer successfully');
  check(pages.every((p,i)=>p.source===originals[i]),'Original identities and page numbers survive baked Pro edits');
  check(pages[2].el.querySelector('.src').textContent==='첨부.pdf'&&pages[1].el.querySelector('.src').title.endsWith('원본 2p'),'Cards retain original filenames and page indices');
  const backing=pages.map(p=>p.docId);await setProMode('pro');await setProMode('basic');check(pages.every((p,i)=>p.docId===backing[i]),'Mode round trip without new edits does not bake again');
  await openBasicSaveDialog();check($('basicSaveFilename').value==='사용자 지정 계약서','Custom Pro filename is retained in Basic save');
  const rows=await text(basicSaveState.bytes);check(rows.length===3&&rows[0].includes('SOURCE ONE')&&rows[1].includes('SOURCE TWO')&&rows[2].includes('ATTACHMENT'),'Saved output keeps all searchable page text');closeBasicSaveDialog();
  await requestEditUndo();check(proMode==='pro'&&$('proNumber').checked&&pages.every((p,i)=>PDFSource.page(p,docs).id===originals[i].id),'Undo restores pre-transfer sources and editable settings');
  $('proNumber').checked=false;refreshProControls();await setProMode('basic');
  const moved=pages[1];select(1,{});moved.el.focus();moved.el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}));await sleep(80);
  check(pages[2]===moved&&document.activeElement===moved.el,'Alt + direction reorders selected page and retains keyboard focus');
  await requestEditUndo();check(pages[1].uid===moved.uid,'Undo restores keyboard page move');
  select(1,{});$('pageOrderButton').click();check(pageOrderDialog.open,'Accessible reorder dialog opens');$('pageOrderPosition').value='1';$('pageOrderApply').click();await sleep(80);check(pages[0].uid===moved.uid&&!pageOrderDialog.open,'Position input moves page without dragging');
  pages[0].el.focus();remove([pages[0]]);check(document.activeElement===pages[0].el,'Delete moves focus to the adjacent page');await requestEditUndo();
  check(!fonts().length,'Page operations and numbered PDF export need no Korean font download');
  const loaded=await PDFMarkupText.load('gothic');check(loaded.font&&loaded.bytes.length>0,'First Korean font loads correctly');const requestCount=fonts().length;await PDFMarkupText.load('gothic');check(fonts().length===requestCount,'Repeated font selection reuses prepared font');
  for(const family of ['myeongjo','hana-regular','hana-bold'])check((await PDFMarkupText.load(family)).font.unitsPerEm>0,'Font ready: '+family);
  const req=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name));check(self.PLANNING_OFFLINE?req.length===0:req.every(r=>new URL(r.name).origin===location.origin),'No document or asset request to an outside origin');
  await setProMode('pro');setProView('workspace');await waitPreview();
  check($('processingBadge').textContent==='내 기기 처리','Local processing location remains explicit');
  if(self.PDFVision){$('ocrProvider').value='vision';$('ocrProvider').dispatchEvent(new Event('change'));check($('processingBadge').textContent.includes('동의 필요'),'Cloud engine selection shows consent requirement');$('ocrProvider').value='paddle-v5';$('ocrProvider').dispatchEvent(new Event('change'));}
  document.body.dataset.planningQA='passed';report('ALL PASSED');
 }catch(e){document.body.dataset.planningQA='failed';report('FAIL '+e.stack);console.error(e);}
})();
