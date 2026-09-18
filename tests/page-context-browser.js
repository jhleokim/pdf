(async()=>{
 const output=document.createElement('pre');output.id='pageContextChecks';output.style='position:fixed;bottom:0;left:0;z-index:99999;background:white;color:black;max-height:18vh;overflow:auto;font:11px monospace';document.body.append(output);
 const lines=[],assert=(v,m)=>{if(!v)throw Error(m);},record=m=>{lines.push(m);output.textContent=lines.join('\n');},sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(fn)=>{for(let i=0;i<500;i++){if(fn())return;await sleep(20);}throw Error('Timed out waiting: '+fn);};
 const menu=$('pageContextMenu'),choose=indices=>{pages.forEach((p,i)=>p.el.classList.toggle('selected',indices.includes(i)));syncCounts();};
 const context=p=>p.el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-3,clientY:innerHeight-3,button:2}));
 const dismiss=()=>menu.querySelector('button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 const action=name=>menu.querySelector('[data-action='+name+']').click();
 async function texts(bytes){const task=pdfjsLib.getDocument({data:bytes.slice(),...DOC_OPTS});try{const pdf=await task.promise,result=[];for(let n=1;n<=pdf.numPages;n++)result.push((await(await pdf.getPage(n)).getTextContent()).items.map(i=>i.str).join(' '));return result;}finally{await task.destroy();}}
 try{
  await setProMode('basic');const doc=await PDFLib.PDFDocument.create();
  for(let i=1;i<=4;i++){const p=doc.addPage(i%2?[400,600]:[600,400]);p.drawText('SOURCE-'+i,{x:35,y:330,size:24});}
  await loadFiles([new File([await doc.save()],'Page actions.pdf',{type:'application/pdf'})]);await sleep(100);choose([0,2]);
  context(pages[2]);assert(!menu.hidden&&selected().length===2,'Right click lost multi-selection');assert(menu.querySelector('.page-context-heading').textContent==='2페이지 선택','Selection count');
  let r=menu.getBoundingClientRect();assert(r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1,'Menu clipped');dismiss();record('Right click preserves selected block; menu fits viewport corners');
  context(pages[1]);assert(selected().length===1&&selected()[0]===pages[1],'Unselected right click did not select only its target');dismiss();assert(document.activeElement===pages[1].el,'Escape did not restore card focus');record('Unselected target becomes the only selection; Escape restores focus');
  pages[1].el.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));assert(!menu.hidden,'Shift+F10');
  menu.querySelector('button').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));assert(document.activeElement.dataset.action==='delete','Keyboard End');dismiss();record('Keyboard context menu and item navigation');
  choose([0,2]);pages[2].el.querySelector('[data-act=menu]').click();assert(!menu.hidden&&selected().length===2,'More button lost multiple selection');dismiss();
  if(innerWidth<=880){r=pages[2].el.querySelector('[data-act=menu]').getBoundingClientRect();assert(r.width>=44&&r.height>=44,'Touch target too small: '+r.width+'x'+r.height+' '+getComputedStyle(pages[2].el.querySelector('[data-act=menu]')).display+' '+document.body.className);}
  record('Touch menu button preserves selection and has a 44px compact target');
  context(pages[2]);action('rotate-left');await wait(()=>pages[0].rotation===270&&pages[2].rotation===270);assert(pages[1].rotation===0,'Rotated an unselected page');await requestEditUndo();assert(pages.every(p=>p.rotation===0),'Rotate undo');record('Batch rotation affects selected pages only; undo restores orientation');
  const ids=pages.map(p=>p.uid);choose([0,2]);context(pages[0]);action('delete');await wait(()=>pages.length===2);assert(pages[0].uid===ids[1]&&pages[1].uid===ids[3],'Wrong pages deleted');await requestEditUndo();assert(pages.map(p=>p.uid).join()===ids.join(),'Delete undo');record('Batch deletion and undo preserve page order');
  choose([1]);context(pages[1]);action('blank-before');await wait(()=>pages.length===5&&!document.body.classList.contains('is-busy'));assert(pages[2].uid===ids[1]&&docs.get(pages[1].docId).kind==='blank','Blank before');await requestEditUndo();
  choose([3]);context(pages[3]);action('blank-after');await wait(()=>pages.length===5&&!document.body.classList.contains('is-busy'));assert(docs.get(pages[4].docId).kind==='blank','Blank after last');await requestEditUndo();record('Blank insertion before selection and after final page; undo');
  choose([0,2]);context(pages[2]);action('save');await wait(()=>basicSaveState?.phase==='ready');assert(basicSaveState.scope==='selected'&&basicSaveState.pages.length===2,'Context save defaults to all pages');
  const out=await texts(basicSaveState.bytes);assert(out.length===2&&out[0].includes('SOURCE-1')&&out[1].includes('SOURCE-3'),'Wrong saved subset');closeBasicSaveDialog();record('Context save prepares only selected pages in current order');
  // Synthetic local OCR metadata: no engine or service is needed to test preservation.
  await setProMode('pro');if(isCompactPro())setProView('pages');
  pages[0].annots=[{id:'a-test',shape:'rect',nx:.2,ny:.1,nw:.2,nh:.1,stroke:'#00857d',fill:'#ffffff',opacity:0,lineWidth:1}];
  pages[0].deskewAngle=0;const options=readProOptions();ocrRecords=pages.map((p,i)=>({uid:p.uid,key:ocrKey(p,options),source:'tesseract',text:'OCR-'+i,words:[{text:'OCR-'+i,box:[.1,.65,.35,.7]}]}));ocrAccepted=true;
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
  stampMarks=[{data:png,name:'Review',scope:'selected',targets:[pages[0].uid],anchor:'bottom-right',width:20,ratio:1,x:10,y:10,opacity:1}];
  choose([0,2]);const sourceCount=docs.size;context(pages[0]);action('duplicate');await wait(()=>pages.length===6&&!document.body.classList.contains('is-busy'));
  const copies=selected();assert(copies.length===2&&pages[3]===copies[0]&&pages[4]===copies[1]&&copies[0].srcIndex===0&&copies[1].srcIndex===2,'Duplicate placement/order');
  assert(docs.size===sourceCount&&copies[0].docId===pages[0].docId,'Duplication reparsed source PDF');assert(copies[0].canvas!==pages[0].canvas,'Shared destructible thumbnail canvas');
  assert(copies[0].annots!==pages[0].annots&&copies[0].annots[0]!==pages[0].annots[0]&&copies[0].annots[0].id!==pages[0].annots[0].id,'Annotations not isolated');
  const current=readProOptions(true);assert(current.ocr.length===6,'Duplicated OCR stale or missing');assert(stampMarks[0].targets.includes(copies[0].uid)&&!stampMarks[0].targets.includes(copies[1].uid),'Stamp copied to wrong page');
  record('Duplicate reuses PDF bytes, isolates thumbnails/annotations and preserves OCR/stamp targets');
  await requestEditUndo();assert(pages.length===4&&ocrRecords.length===4&&stampMarks[0].targets.length===1,'Duplicate undo left stale OCR/stamps');readProOptions(true);
  await requestEditUndo(true);assert(pages.length===6&&readProOptions(true).ocr.length===6&&stampMarks[0].targets.length===2,'Duplicate redo lost OCR/stamps');record('Duplicate undo/redo preserves accepted OCR and stamp metadata');
  context(pages[3]);action('save');await wait(()=>basicSaveState?.phase==='ready'||basicSaveState?.phase==='error');assert(basicSaveState.phase==='ready','Duplicate save: '+$('basicSaveError').textContent);
  const proText=await texts(basicSaveState.bytes);assert(proText.length===2&&proText[0].includes('OCR-0')&&proText[1].includes('OCR-2'),'Saved duplicate lost searchable OCR');closeBasicSaveDialog();record('Duplicated Pro pages export with searchable text');
  if(isCompactPro())setProView('pages');await sleep(150);const more=pages[3].el.querySelector('[data-act=menu]');assert(getComputedStyle(more.parentElement).display!=='none','Pro touch menu is hidden');more.click();assert(!menu.hidden,'Pro rail/pages menu failed');dismiss();record('Same menu is available in the Pro rail and compact pages view');
  context(pages[3]);board.dispatchEvent(new Event('scroll',{bubbles:false}));assert(menu.hidden,'Menu stayed open during scrolling');
  busy(true,'test');context(pages[0]);assert(menu.hidden,'Busy state allowed page action');busy(false);record('Scrolling closes menu; active processing blocks page actions');
  assert(!performance.getEntriesByType('resource').some(r=>/^https?:/.test(r.name)&&new URL(r.name).origin!==location.origin),'External request');record('No external document/service request');
  output.textContent='PASS · '+lines.length+' page-context checks\n'+lines.join('\n');
 }catch(e){output.textContent=lines.join('\n')+'\nFAIL '+e.stack;console.error(e);}finally{if(parent!==window)parent.postMessage({pageContextReport:output.textContent},'*');}
})();
