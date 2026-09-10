(async()=>{
 const out=$('modeSyncChecks'),checks=[],assert=(v,m)=>{if(!v)throw Error(m)},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const record=m=>{checks.push(m);out.textContent=checks.join('\n')};
 const ready=async()=>{for(let i=0;i<400;i++){await wait(30);if($('proCompare').getAttribute('aria-busy')!=='true'){assert(!$('proCompare').hasAttribute('data-error')&&$('compareAfter').width>0,'Pro preview failed');return;}}throw Error('Pro preview timed out');};
 const pdfText=async bytes=>{const pdf=await pdfjsLib.getDocument({data:bytes.slice(),...DOC_OPTS}).promise;try{const rows=[];for(let i=1;i<=pdf.numPages;i++)rows.push((await(await pdf.getPage(i)).getTextContent()).items.map(x=>x.str).join(' '));return rows;}finally{await pdf.destroy();}};
 const colorCount=(canvas,color)=>{const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let n=0;for(let i=0;i<data.length;i+=4)if(color==='red'?data[i]>data[i+1]+60&&data[i]>data[i+2]+60:data[i+2]>data[i]+60&&data[i+2]>data[i+1]+60)n++;return n;};
 const edit=async(p,text)=>{await setProMode('basic');if(isMobile())setMobileView('preview');await showPreview(p);await openTextEditor(null,p.annots.find(a=>a.shape==='text'));$('textInput').value=text;await queueTextChange({text});};
 try{
  setProMode('basic');const doc=await PDFDocument.create();for(const label of ['SOURCE ONE','SOURCE TWO','SOURCE THREE'])doc.addPage([400,600]).drawText(label,{x:40,y:550,size:18});
  await loadFiles([new File([await doc.save()],'Mode transfer.pdf',{type:'application/pdf'})]);const [first,second,third]=pages;
  if(isMobile())setMobileView('preview');await showPreview(first);await openTextEditor({x:.12,y:.2});$('textInput').value='Basic 첫 편집';await queueTextChange({text:$('textInput').value,fontSize:24,color:'#cc0000'});const text=textEditing.a;finishTextEdit(true);
  const shape={id:'sync-shape',shape:'rect',nx:.15,ny:.4,nw:.3,nh:.15,fill:'#2233cc',opacity:1,stroke:'#2233cc',lineWidth:1};first.annots.push(shape);renderAnnots();syncCounts();
  assert(first.el.querySelector('.thumbnail-markup')?.textContent.includes('Basic 첫 편집'),'Page thumbnails still show only the original import');record('Basic page thumbnails contain the current text and shapes');
  const stampCanvas=document.createElement('canvas');stampCanvas.width=stampCanvas.height=8;stampCanvas.getContext('2d').fillStyle='#008c82';stampCanvas.getContext('2d').fillRect(0,0,8,8);const url=stampCanvas.toDataURL('image/png');
  stamps.set('sync-image',{mime:'image/png',bytes:b64bytes(url.split(',')[1]),url,ratio:1});
  first.annots.push({id:'sync-image',shape:'image',stamp:'sync-image',nx:.7,ny:.4,nw:.1,nh:.1,opacity:1},{id:'sync-highlight',shape:'highlight',nx:.1,ny:.65,nw:.5,nh:.03,fill:'#ffe082',opacity:.4,stroke:'none',lineWidth:0});renderAnnots();
  assert(first.el.querySelector('.thumbnail-markup image')?.getAttribute('href')===url&&first.el.querySelector('.thumbnail-markup [data-uid="sync-highlight"]'),'Thumbnail omitted an image or highlight');record('Image and highlight markup are included in the shared page thumbnail');
  $('proOptimize').checked=false;setProMode('pro');await ready();
  assert(colorCount($('compareAfter'),'red')>20&&colorCount($('compareAfter'),'blue')>100,'Basic annotations missing in Pro');
  assert(colorCount($('compareBefore'),'red')>20,'Original comparison discarded Basic edits');record('Pro result and original comparison both start from the Basic edited page');
  await createProResult();await ready();assert(proResult&&proResult.fingerprint===proFingerprint(),'Result cache fingerprint differs');assert((await pdfText(proResult.bytes))[0].includes('Basic 첫 편집'),'Saved Pro result uses the original input');record('Saved Pro PDF includes searchable Basic text');
  await edit(first,'수정된 두 번째 입력');await setProMode('pro');await ready();assert(!proResult,'Old prepared download was retained after Basic edits');
  assert((await(await liveDocs[1].getPage(1)).getTextContent()).items.some(x=>x.str.includes('수정된 두 번째 입력')),'Returning to Pro reused old content');record('Returning from Basic replaces cached preview and invalidates the prior download');
  await edit(first,'대기 전');const layout=relayoutText;let release;const gate=new Promise(r=>release=r);relayoutText=async a=>{await gate;return layout(a)};
  try{
   $('textInput').value='마지막 입력까지 전달';const update=queueTextChange({text:$('textInput').value});const switched=setProMode('pro');assert(proMode==='basic'&&textEditing,'Unfinished input was discarded');release();await update;await switched;
   assert(proMode==='pro'&&!textEditing&&text.text==='마지막 입력까지 전달','One Pro click during text layout did not complete the transition');
  }finally{release?.();relayoutText=layout;}
  await ready();assert((await(await liveDocs[1].getPage(1)).getTextContent()).items.some(x=>x.str.includes('마지막 입력까지 전달')),'Pending text was omitted');record('One Pro click waits for pending Korean input and displays the final text');
  setProView('settings');$('modePro').click();assert(document.body.dataset.proView==='settings','Clicking the active Pro button reset the workspace');record('Clicking the active Pro button preserves the workspace layout');
  await edit(first,'마지막 모드 선택');let release2;const gate2=new Promise(r=>release2=r);relayoutText=async a=>{await gate2;return layout(a)};
  try{const update=queueTextChange({text:'빠른 전환'}),a=setProMode('pro'),b=setProMode('basic');release2();await Promise.all([update,a,b]);assert(proMode==='basic','An earlier Pro click overrode the latest Basic click');}finally{release2?.();relayoutText=layout;}record('Rapid mode clicks honor the most recent mode choice');
  await edit(first,'지원하지 않는 문자 😀');setProMode('pro');assert(proMode==='basic'&&textEditing&&$('textError').textContent,'An invalid draft was silently discarded');finishTextEdit(false);record('Invalid input stays editable instead of silently disappearing on a mode switch');
  rotate([first],90);commitMove([third.uid],first.uid);remove([second]);await insertBlankPage({beforeUid:first.uid});const blank=pages.find(p=>docs.get(p.docId).kind==='blank');await showPreview(first);
  setProMode('pro');await ready();await createProResult();await ready();const rows=await pdfText(proResult.bytes),output=await PDFDocument.load(proResult.bytes);
  assert(rows.length===3&&rows[0].includes('SOURCE THREE')&&!rows[1].trim()&&rows[2].includes('SOURCE ONE')&&!rows.join().includes('SOURCE TWO'),'Pro lost Basic page order/insertion/deletion');
  assert(output.getPage(2).getRotation().angle===90&&pages[1]===blank,'Pro lost Basic page rotation');record('Pro export preserves Basic page order, deletion, blank insertion and rotation');
  setProMode('basic');await showPreview(first);selAnno=text.id;renderAnnots();$('annoDel').click();assert(!first.el.querySelector('.thumbnail-markup')?.textContent.includes(text.text),'Removed text remains on thumbnail');
  await requestEditUndo();assert(first.el.querySelector('.thumbnail-markup')?.textContent.includes(text.text),'Undo did not refresh thumbnail');record('Markup deletion and Undo refresh the page thumbnail');
  setProMode('pro');await ready();setLivePreviewOpen(false);setLivePreviewOpen(true);await ready();assert(colorCount($('compareAfter'),'red')>10,'Reopened preview omitted restored markup');record('Closing and reopening Pro preview uses the restored editing state');
  const network=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name)&&new URL(e.name).origin!==location.origin);assert(!network.length,'External dependency');
  out.textContent='PASS · '+checks.length+' mode-sync checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e)}finally{if(parent!==window)parent.postMessage({modeSyncReport:out.textContent},location.origin)}
})();
