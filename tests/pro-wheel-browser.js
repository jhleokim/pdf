(async()=>{
 const out=$('proWheelReport'),checks=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)},record=m=>{checks.push(m);out.textContent=checks.join('\n');};
 const ready=async()=>{for(let i=0;i<500;i++){await wait(30);if($('proCompare').getAttribute('aria-busy')!=='true'){assert(!$('proCompare').hasAttribute('data-error'),'Preview failed');return;}}throw Error('Preview timed out');};
 const wheel=(dy,ctrl=true,deltaMode=0)=>{const s=$('compareAfterScroll').getBoundingClientRect(),e=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:ctrl,deltaY:dy,deltaMode,clientX:s.left+s.width/2,clientY:s.top+s.height/2});$('compareAfter').dispatchEvent(e);return e;};
 const choose=async n=>{$('compareZoom').value=String(n);$('compareZoom').dispatchEvent(new Event('change'));await ready();};
 try{
  await setProMode('basic');const doc=await PDFDocument.create();for(let i=0;i<2;i++)doc.addPage([500,700]).drawText('ZOOM TEST '+i,{x:50,y:620,size:20});await loadFiles([new File([await doc.save()],'Pro zoom.pdf',{type:'application/pdf'})]);$('proOptimize').checked=false;$('proDeskew').checked=false;await setProMode('pro');await ready();
  const cached=liveDocs.slice(),width=$('compareAfter').getBoundingClientRect().width;
  assert(!wheel(-120,false).defaultPrevented&&Number($('compareZoom').value)===1,'Ordinary scroll intercepted');
  assert(wheel(-120).defaultPrevented,'Browser zoom was not prevented');await ready();assert(Number($('compareZoom').value)>1&&$('compareAfter').getBoundingClientRect().width>width,'Wheel up did not enlarge');
  assert(liveDocs[0]===cached[0]&&liveDocs[1]===cached[1],'Zoom reprocessed the PDF');record('Ctrl+wheel enlarges preview; ordinary scroll is untouched; processed PDF is reused');
  const up=Number($('compareZoom').value);wheel(120);await ready();assert(Number($('compareZoom').value)<up,'Wheel down did not shrink');assert(!$('compareZoom').value.includes('NaN'),'Invalid zoom');record('Wheel down shrinks and the zoom menu follows');
  await choose(3);const r=$('compareAfter').getBoundingClientRect(),s=$('compareAfterScroll').getBoundingClientRect(),x=s.left+s.width/2,y=s.top+s.height/2,nx=(x-r.left)/r.width,ny=(y-r.top)/r.height;
  wheel(-120);await ready();const after=$('compareAfter').getBoundingClientRect();assert(Math.abs(after.left+nx*after.width-x)<3&&Math.abs(after.top+ny*after.height-y)<3,'Pointer anchor drifted');record('The document point under the pointer stays in place');
  for(let i=0;i<35;i++)wheel(-300);await ready();assert(Number($('compareZoom').value)===5,'Upper bound');assert($('compareAfter').width<=8192&&$('compareAfter').height<=8192,'Canvas side budget');
  for(let i=0;i<35;i++)wheel(300);await ready();assert(Number($('compareZoom').value)===.25,'Lower bound or empty menu');record('Rapid wheel input is capped at 25–500% without invalid menu state');
  await choose(2);$('compareOriginal').click();assert($('compareStage').classList.contains('show-original'),'Original comparison failed');wheel(-3,true,1);await ready();assert($('compareStage').classList.contains('show-original'),'Zoom closed original comparison');$('compareOriginal').click();record('Original comparison remains open during zoom; line-mode wheel works');
  const factor=Number($('compareZoom').value);await showPreview(pages[1]);await ready();assert(Number($('compareZoom').value)===factor,'Page change lost zoom');assert(liveZoomAnchor===null,'Old page retained pointer anchor');record('Page changes retain zoom and discard stale anchors');
  wheel(-100);setLivePreviewOpen(false);await wait(150);assert(liveDocs.length===0&&liveZoomAnchor===null,'Closing left live resources');setLivePreviewOpen(true);await ready();record('Closing during zoom cancels pending rendering and reopens cleanly');
  await choose(1);assert(Math.abs($('compareAfter').getBoundingClientRect().width-width)<2,'Fit reset failed');
  out.textContent='PASS · '+checks.length+' checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e);}
})();
