(async()=>{
 if(!$('arrowChecks')){const panel=document.createElement('pre');panel.id='arrowChecks';panel.style='position:fixed;bottom:0;left:0;z-index:99999;max-height:24vh;overflow:auto;background:white;color:black;padding:8px;font:11px monospace';document.body.append(panel);}
 const checks=[],out=$('arrowChecks'),record=m=>{checks.push(m);out.textContent=checks.join('\n');},assert=(v,m)=>{if(!v)throw Error(m)},wait=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  const d=await PDFDocument.create();for(const size of [[842,595],[595,842],[595,842]]){const p=d.addPage(size);p.drawText('PUBLIC DOCUMENT',{x:35,y:100,size:20});}d.getPage(2).setRotation(degrees(90));
  await loadFiles([new File([await d.save()],'Mixed orientation.pdf',{type:'application/pdf'})]);await setProMode('basic');if(isMobile())setMobileView('preview');await wait(250);await showPreview(pages[0]);
  const button=document.querySelector('[data-tool=arrow]');assert(button.previousElementSibling.dataset.tool==='cloud','Arrow not after cloud');button.click();
  assert(!$('annoProperties').hidden&&$('annoFillGroup').hidden,'Arrow should only expose opaque stroke controls');
  const event=(type,x,y,target=$('pvOverlay'))=>{const r=$('pvCanvas').getBoundingClientRect();target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:44,pointerType:isMobile()?'touch':'mouse',isPrimary:true,button:0,clientX:r.left+r.width*x,clientY:r.top+r.height*y}));};
  const paths=[[.15,.2,.6,.2],[.7,.2,.7,.65],[.65,.7,.2,.35],[.25,.7,.6,.35]];
  for(const [x,y,ex,ey]of paths){setTool('arrow');event('pointerdown',x,y);event('pointermove',ex,ey);event('pointerup',ex,ey);}
  assert(curAnnots().filter(a=>a.shape==='arrow').length===4,'Horizontal/vertical/reverse arrows lost '+JSON.stringify({count:curAnnots().length,hidden:$('pvStage').hidden,tool:annoStyle.tool,drag:!!drag,pending:textEditPending}));record('4 directions, horizontal and vertical drawing');
  const arrow=curAnnots().at(-1),fixed=[arrow.nx,arrow.ny];const endpoint=$('pvOverlay').querySelector('[data-h=end]');assert(endpoint,'Endpoint handles missing');
  event('pointerdown',.6,.35,endpoint);event('pointermove',.12,.8);event('pointerup',.12,.8);
  assert(arrow.nw<0&&arrow.nh>0&&arrow.nx===fixed[0]&&arrow.ny===fixed[1],'Endpoint drag moved fixed end');record('Endpoint drag crosses the start without flipping or jumping');
  const previous=JSON.stringify(arrow);event('pointerdown',.12,.8,$('pvOverlay').querySelector('[data-h=end]'));event('pointermove',.9,.9);event('pointercancel',.9,.9);assert(JSON.stringify(arrow)===previous,'Canceled endpoint edit leaked');
  const count=curAnnots().length;setTool('arrow');event('pointerdown',.1,.1);event('pointermove',.4,.1);event('pointerup',.4,.1);await requestEditUndo();assert(curAnnots().length===count,'Undo failed');record('Cancel and undo restore arrow geometry');
  const doc=await buildEditedDocument([pages[0]]),saved=await doc.save(),task=pdfjsLib.getDocument({data:saved.slice(),...DOC_OPTS});
  try{const pdf=await task.promise,p=await pdf.getPage(1),text=await p.getTextContent();assert(text.items.some(t=>t.str==='PUBLIC DOCUMENT'),'Export removed text');
   const images=doc.context.enumerateIndirectObjects().filter(([,v])=>v instanceof PDFLib.PDFRawStream&&String(v.dict.get(PDFLib.PDFName.of('Subtype')))==='/Image');assert(images.length===0,'Arrows rasterized page');
   const vp=p.getViewport({scale:1}),canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;await p.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
   const data=canvas.getContext('2d').getImageData(Math.floor(.2*vp.width),Math.floor(.19*vp.height),Math.floor(.35*vp.width),Math.ceil(.02*vp.height)).data;let red=0;for(let i=0;i<data.length;i+=4)if(data[i]>100&&data[i]>data[i+1]*1.5)red++;assert(red>150,'Exported arrow absent');canvas.width=canvas.height=0;
  }finally{await task.destroy();}record('Vector arrow export retains searchable text');
  await setProMode('pro');for(let n=0;n<100&&$('proCompare').getAttribute('aria-busy')==='true';n++)await wait(60);
  if(!isMobile())for(const p of pages){const s=p.el.querySelector('.sheet').getBoundingClientRect(),expected=p.srcIndex===1?595/842:842/595;assert(Math.abs(s.width/s.height-expected)<.02,'Thumbnail ratio mismatch '+p.srcIndex);}
  const slot=$('compareAfterScroll'),c=$('compareAfter').getBoundingClientRect();assert(c.width<=slot.clientWidth&&c.height<=slot.clientHeight,'Page fit exceeds preview');record('Mixed portrait, landscape and rotated page sizes fit preview');
  await setProMode('basic');if(isMobile())setMobileView('preview');await showPreview(pages[0]);setTool('rect');await wait(150);
  const bar=$('annoBar').getBoundingClientRect();assert($('annoBar').scrollWidth<=$('annoBar').clientWidth+1,'Toolbar horizontally overflows');assert(bar.height<120,'Toolbar occupies excessive space');record('Compact toolbar fits available width');
  out.textContent='PASS · '+checks.length+' checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e);}finally{if(parent!==window)parent.postMessage({arrowReport:out.textContent},location.origin);}
})();
