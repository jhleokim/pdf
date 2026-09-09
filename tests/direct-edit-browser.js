(async()=>{
 const out=$('directChecks'),checks=[],assert=(v,m)=>{if(!v)throw Error(m)},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const record=m=>{checks.push(m);out.textContent=checks.join('\n')};
 const render=async(bytes)=>{const doc=await pdfjsLib.getDocument({data:bytes.slice(),...DOC_OPTS}).promise,page=await doc.getPage(1),vp=page.getViewport({scale:1}),canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;await doc.destroy();return canvas;};
 const choose=(start,end,offset=0,endOffset=end.textContent.length)=>{const r=document.createRange();r.setStart(start.firstChild,offset);r.setEnd(end.firstChild,endOffset);const s=getSelection();s.removeAllRanges();s.addRange(r);};
 try{
  await setupDirectDocument();const original=pages[0];if(innerWidth>880)await setEditingFocus(true);
  setTool('highlight');const spans=[...highlightLayer.querySelectorAll('span')],first=spans.find(s=>s.textContent.startsWith('문서 편집')),second=spans.find(s=>s.textContent.startsWith('필요한 문장'));
  assert(highlightHasText&&!highlightLayer.hidden&&$('annoProperties').hidden,'Searchable page does not offer text highlighting');
  const bounds=$('pvCanvas').getBoundingClientRect(),layer=highlightLayer.getBoundingClientRect();assert(Math.abs(layer.width-bounds.width)<2&&Math.abs(layer.height-bounds.height)<2,'Selectable text does not track rendered page');record('Text selection follows the PDF page at the current zoom');
  choose(first,second,3,14);applySelectedHighlight();const mark=curAnnots().at(-1);
  assert(mark.shape==='highlight'&&mark.quads.length===2&&mark.nh<.09,'Multi-line selection became a large area');
  assert(annoStyle.tool==='highlight'&&!getSelection().rangeCount,'Highlighter does not stay active');record('A partial two-line selection makes two precise highlight strips');
  setHighlightStyle({color:'#9bd4ae',opacity:.45});choose(first,first,0,2);applySelectedHighlight();assert(curAnnots().at(-1).fill==='#9bd4ae'&&curAnnots().at(-1).opacity===.45,'Style was lost');
  setTool('none');setTool('highlight');assert(annoStyle.fill==='#9bd4ae'&&annoStyle.opacity===.45,'Selecting the tool reset its style');record('Repeated highlighting keeps the chosen color and strength');
  const markedDoc=await buildEditedDocument([original]),markedCanvas=await render(await markedDoc.save()),sample=markedCanvas.getContext('2d').getImageData(0,0,markedCanvas.width,markedCanvas.height).data;
  let green=0,yellow=0;for(let i=0;i<sample.length;i+=4){if(sample[i+1]>sample[i]+8&&sample[i+1]>sample[i+2]+3)green++;if(sample[i]>sample[i+2]+20&&sample[i+1]>sample[i+2]+10)yellow++;}
  assert(green>20&&yellow>150,'Saved PDF does not contain colored highlights');record('Highlight strips survive PDF export with their colors');
  for(const rotation of [90,180,270]){
   const doc=await PDFDocument.create(),page=doc.addPage([400,600]);page.setCropBox(20,30,300,500);page.setRotation(degrees(rotation));page.node.set(PDFLib.PDFName.of('UserUnit'),PDFLib.PDFNumber.of(2));page.drawText('Rotated text selection',{x:60,y:430,size:18});
   await loadFiles([new File([await doc.save()],'Rotation '+rotation+'.pdf',{type:'application/pdf'})]);await showPreview(pages.at(-1));setTool('highlight');
   const span=[...highlightLayer.querySelectorAll('span')].find(s=>s.textContent.startsWith('Rotated'));assert(span,'Rotated text layer missing');
   const r=span.getBoundingClientRect(),p=$('pvCanvas').getBoundingClientRect();assert(r.left>=p.left-1&&r.top>=p.top-1&&r.right<=p.right+1&&r.bottom<=p.bottom+1,'Rotated layer is outside page');
   choose(span,span,0,7);applySelectedHighlight();const a=curAnnots().at(-1),exported=await buildEditedDocument([pages.at(-1)]),cv=await render(await exported.save());
   const x=Math.max(0,Math.floor(a.nx*cv.width)),y=Math.max(0,Math.floor(a.ny*cv.height)),w=Math.min(cv.width-x,Math.ceil(a.nw*cv.width)),h=Math.min(cv.height-y,Math.ceil(a.nh*cv.height)),pixels=cv.getContext('2d').getImageData(x,y,w,h).data;
   let colored=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>pixels[i]+8&&pixels[i+1]>pixels[i+2]+3)colored++;assert(colored>20,'Rotated highlight output misplaced '+rotation);
  }record('Text selection and saved highlights agree at 90/180/270°, CropBox and UserUnit=2');
  await insertBlankPage({beforeUid:null});const blank=selected()[0];await showPreview(blank);setTool('highlight');assert(!highlightHasText&&highlightLayer.hidden&&$('highlightTextMode').disabled&&$('highlightAreaMode').getAttribute('aria-pressed')==='true','Scan/blank did not fall back to area');
  const ov=$('pvOverlay'),r=$('pvCanvas').getBoundingClientRect(),pointer=(type,x,y)=>ov.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:53,pointerType:'mouse',button:0,clientX:r.left+x*r.width,clientY:r.top+y*r.height}));
  for(const y of [.2,.4]){pointer('pointerdown',.1,y);pointer('pointermove',.6,y+.04);pointer('pointerup',.6,y+.04);}
  assert(curAnnots().length===2&&annoStyle.tool==='highlight','Area tool requires reselecting after each mark');
  pointer('pointerdown',.1,.6);pointer('pointermove',.6,.64);pointer('pointercancel',.6,.64);assert(curAnnots().length===2,'Canceled gesture committed a mark');undoLastHighlight();assert(curAnnots().length===1,'Undo did not remove only the latest highlight');record('Scans use repeatable area highlighting; cancellation and last-highlight undo work');
  await showPreview(original);setTool('text');await openTextEditor({x:.12,y:.74});$('textInput').value='한글 ABC 123 가나다라마 검토 완료';await queueTextChange({text:$('textInput').value,fontSize:18,font:'gothic'});
  const a=textEditing.a,rect=$('pvCanvas').getBoundingClientRect(),input=$('textEditor').getBoundingClientRect();
  assert($('pvStage').contains($('textInput'))&&Math.abs(input.left-(rect.left+a.nx*rect.width-3))<2,'Text input is not on the page');
  const toolbar=$('annoBar').getBoundingClientRect().height;finishTextEdit(true);assert(Math.abs($('annoBar').getBoundingClientRect().height-toolbar)<1,'Applying text jumps the document');record('Text is entered on the page; applying it preserves the toolbar geometry');
  const exported=await buildEditedDocument([original]),actual=await render(await exported.save());
  const reference=await PDFDocument.load(docs.get(original.docId).libBytes),fontData=await PDFMarkupText.load('gothic');reference.registerFontkit(fontkit);const font=await reference.embedFont(fontData.bytes,{subset:false}),rp=reference.getPage(0);
  a.textLayout.lines.forEach((line,i)=>rp.drawText(line,{x:a.nx*595,y:842-a.ny*842-a.textLayout.ascent-i*a.textLayout.step,font,size:a.fontSize}));
  const expected=await render(await reference.save()),x=Math.floor(a.nx*595)-2,y=Math.floor(a.ny*842)-2,w=Math.ceil(a.nw*595)+4,h=Math.ceil(a.nh*842)+4,A=actual.getContext('2d').getImageData(x,y,w,h).data,E=expected.getContext('2d').getImageData(x,y,w,h).data;
  let expectedInk=0,matchingInk=0;for(let i=0;i<E.length;i+=4)if(E[i]<180){expectedInk++;if(A[i]<200)matchingInk++;}
  assert(expectedInk>200&&matchingInk/expectedInk>.9,'Saved text drops visible glyphs: '+matchingInk+'/'+expectedInk);record('Saved Korean and Latin glyphs visually match an independent full-font reference');
  await openTextEditor(null,a);$('textInput').value='취소한 수정';await queueTextChange({text:$('textInput').value});finishTextEdit(false);assert(a.text.includes('가나다라마'),'Cancel lost original text');
  const network=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name)&&new URL(e.name).origin!==location.origin);assert(!network.length,'External assets requested');record('Cancel restores the text; editing works with external connections blocked');
  out.textContent='PASS · '+checks.length+' direct-edit checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e)}finally{if(parent!==window)parent.postMessage({directReport:out.textContent},location.origin)}
})();
