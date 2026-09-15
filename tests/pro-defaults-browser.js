(async()=>{
 const out=document.createElement('output');out.id='proDefaultsReport';out.style='position:fixed;bottom:2px;left:8px;z-index:9999;background:white;color:black;font:11px monospace;white-space:pre-wrap;pointer-events:none';document.body.append(out);
 const checks=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)},record=m=>{checks.push(m);out.textContent=checks.join('\n');};
 const off=()=>{const o=readProOptions();assert(!o.optimize&&!o.deskew&&!o.blackWhite&&!o.crop&&!o.number&&o.contrast===0&&o.whitePoint===255&&o.paper==='original'&&!o.watermark,'An automatic correction is enabled');};
 const ready=async()=>{for(let n=0;n<200;n++){await wait(30);if($('proCompare').getAttribute('aria-busy')!=='true')return;}throw Error('Preview timeout');};
 try{
  off();const doc=await PDFDocument.create(),p=doc.addPage([595,842]);p.drawText('UNCHANGED CONTRACT 1234',{x:40,y:760,size:16});
  await loadFiles([new File([await doc.save()],'Default check.pdf',{type:'application/pdf'})]);
  const original=pages[0],source=docs.get(original.docId);await setProMode('pro');await ready();off();assert(!hasProEdits(),'Entering Pro introduced effects');
  assert(await setProMode('basic'),'Basic switch failed');assert(pages[0]===original&&docs.get(original.docId)===source,'Unedited mode switch replaced the source');
  await setProMode('pro');await ready();off();record('Fresh start and Basic/Pro round trip keep all corrections off and retain original source');
  $('proOptimize').checked=true;$('proGrayscale').checked=true;$('proDeskew').checked=true;$('proContrast').value='20';$('proWhitePoint').value='220';resetProOptions();await ready();off();record('Reset returns compression, deskew, B&W, contrast and background correction to off');
  const sections=[...document.querySelectorAll('.pro-panel-scroll > details.pro-section')];assert(sections.at(-1).id==='ocrSection'&&sections.at(-2).id==='compressionSection','OCR is not the last tool');
  for(const id of ['ocrSection','ocrProvider','ocrRun','compressionSection'])assert(document.querySelectorAll('#'+id).length===1,'Duplicate section/control: '+id);record('OCR is last after compression, with one set of engine controls');
  if(innerWidth<=880)setProView('settings');await wait(300);
  const button=[...document.querySelectorAll('.help-dot')].find(b=>b.getBoundingClientRect().width>0),tip=$('contextHelp');assert(button,'No visible help button');
  const pointer=(type,pointerType='mouse',x=10,y=10)=>button.dispatchEvent(new PointerEvent(type,{pointerType,clientX:x,clientY:y,bubbles:true}));
  pointer('pointerenter');await wait(750);assert(tip.hidden,'Hover help appeared before one second');await wait(400);assert(!tip.hidden&&button.getAttribute('aria-describedby')==='contextHelp','Hover help did not appear after one second');pointer('pointerleave');assert(tip.hidden,'Help remains after leaving');record('Mouse hover waits one second and leaves immediately');
  pointer('pointerenter');await wait(200);pointer('pointerleave');await wait(1000);assert(tip.hidden,'A canceled hover timer showed late help');record('Passing over an icon cancels delayed help');
  pointer('pointerenter');pointer('pointerdown');button.focus();await wait(100);assert(tip.hidden,'Mouse focus bypassed the hover delay');pointer('pointerleave');button.blur();
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));button.focus();assert(!tip.hidden,'Keyboard focus has no accessible help');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(tip.hidden,'Escape did not dismiss help');button.blur();record('Mouse click does not bypass delay; keyboard focus and Escape remain accessible');
  pointer('pointerdown','touch');await wait(380);assert(!tip.hidden,'Touch hold no longer opens help');pointer('pointerup','touch');assert(tip.hidden,'Touch release left help visible');
  pointer('pointerdown','touch');await wait(380);assert(!tip.hidden,'Second touch hold did not open help');pointer('pointermove','touch',30,30);assert(tip.hidden,'Moving after touch help opened did not dismiss it');pointer('pointerup','touch');
  pointer('pointerdown','touch');pointer('pointermove','touch',30,30);await wait(380);assert(tip.hidden,'Touch movement failed to cancel help');record('Touch hold/release and movement cancellation still work');
  out.textContent='PASS · '+checks.length+' checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e);}finally{if(parent!==window)parent.postMessage({proDefaultsReport:out.textContent},location.origin);}
})();
