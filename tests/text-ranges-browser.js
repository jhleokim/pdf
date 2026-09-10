(async()=>{
 const out=$('rangeChecks'),checks=[],assert=(v,m)=>{if(!v)throw Error(m)},record=m=>{checks.push(m);out.textContent=checks.join('\n')},input=$('textInput');
 const key=()=>{const e=new KeyboardEvent('keydown',{key:'b',ctrlKey:true,bubbles:true,cancelable:true});input.dispatchEvent(e);return e;};
 const type=async(value,start=input.selectionStart,end=input.selectionEnd,inputType='insertText')=>{input.setSelectionRange(start,end);input.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType}));input.value=value;input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType}));await textUpdate;};
 const render=async bytes=>{const doc=await pdfjsLib.getDocument({data:bytes,...DOC_OPTS}).promise,p=await doc.getPage(1),vp=p.getViewport({scale:2}),canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);await p.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;const text=(await p.getTextContent()).items.map(i=>i.str).join('');await doc.destroy();return {canvas,text};};
 const dark=(canvas,box)=>{const data=canvas.getContext('2d').getImageData(...box).data;let n=0;for(let i=0;i<data.length;i+=4)if(data[i]<170)n++;return n;};
 try{
  setProMode('basic');await insertBlankPage();const page=pages[0];if(isMobile())setMobileView('preview');else await setEditingFocus(true);await showPreview(page);await openTextEditor({x:.12,y:.12});
  assert(textEditing.a.fontSize===14&&$('textSizeNumber').value==='14'&&$('textSize').value==='14','Default text size is not 14pt');record('New text starts at 14 pt in the model and both controls');
  key();assert(textEditing.a.bold&&!input.value,'Empty input cannot enable bold');key();assert(!textEditing.a.bold,'Empty input cannot disable bold');record('Ctrl+B also toggles bold before any text has been entered');
  await type('일반 굵게 ABC 마지막');await queueTextChange({fontSize:24});const a=textEditing.a;
  if(new URL(location.href).searchParams.has('visual')){out.hidden=true;return;}
  input.focus();input.setSelectionRange(3,5);const focused=document.activeElement===input,layout=a.textLayout;
  const event=key();assert(event.defaultPrevented&&!a.bold&&JSON.stringify(a.boldRanges)==='[{"start":3,"end":5}]','Ctrl+B did not format only the selection');
  assert(!textEditPending&&a.textLayout===layout&&!$('textInputMirror').hidden,'Partial bold did not paint synchronously');
  assert([...$('textInputMirror').children].filter(s=>s.style.fontWeight==='700').map(s=>s.textContent).join('')==='굵게','Input styles the wrong letters');
  assert(input.selectionStart===3&&input.selectionEnd===5&&(!focused||document.activeElement===input),'Ctrl+B changed focus or selection');record('Ctrl+B paints only selected letters immediately and preserves the selection');
  key();assert(!a.boldRanges.length&&$('textInputMirror').hidden,'Ctrl+B did not remove selected bold');key();await textUpdate;
  await requestEditUndo();assert(!a.boldRanges.length&&input.selectionStart===3&&input.selectionEnd===5,'Undo lost the range or retained selected bold');await requestEditUndo(true);assert(a.boldRanges[0].start===3,'Redo lost selected bold');record('Selected bold toggles and supports Ctrl+Z / redo');
  input.setSelectionRange(2,2);key();assert(a.bold&&!a.boldRanges.length&&$('textInputMirror').hidden&&getComputedStyle(input).fontWeight==='700','Collapsed Ctrl+B did not make the entire input bold');key();assert(!a.bold&&!a.boldRanges.length,'Whole-input bold did not toggle off');record('Without a text selection, Ctrl+B toggles the entire input');
  input.setSelectionRange(3,5);$('textBold').click();await textUpdate;assert(a.boldRanges[0]?.start===3,'Toolbar B differs from the shortcut');
  await type('앞 일반 굵게 ABC 마지막',0,0);assert(a.boldRanges[0].start===5&&a.boldRanges[0].end===7,'Typing before bold shifted its meaning');
  await type('앞 일반 강조 ABC 마지막',5,7);assert(a.boldRanges[0].start===5&&a.boldRanges[0].end===7,'Replacing selected bold lost formatting');record('The B button follows the shortcut; insertion and replacement retain bold ranges');
  await applyTextEditor();const id=a.id;assert($('textInputMirror').hidden&&curAnnots().find(x=>x.id===id).boldRanges.length===1,'Apply lost partial bold');
  const drawn=[...$('pvOverlay').querySelectorAll('[data-uid="'+id+'"] text')];assert(drawn.filter(t=>t.hasAttribute('stroke')).map(t=>t.textContent).join('')==='강조','Applied SVG did not retain partial bold');
  await openTextEditor(null,a);input.setSelectionRange(0,2);key();finishTextEdit(false);assert(a.boldRanges.length===1&&a.boldRanges[0].start===5,'Cancel did not restore partial bold');record('Apply, reopening and Cancel preserve the selected formatting');
  await openTextEditor(null,a);const relayout=relayoutText;let release,pending;
  try{const gate=new Promise(r=>release=r);relayoutText=async value=>{await gate;return relayout(value)};input.value='지연된 새 텍스트';pending=queueTextChange({text:input.value});input.setSelectionRange(4,5);key();assert(textEditPending&&!$('textInputMirror').hidden,'Pending layout hid partial bold');release();await pending;await textUpdate;assert(a.text===input.value&&PDFMarkupText.boldMask(a)[4],'Late layout overwrote selected bold');}finally{release?.();relayoutText=relayout;}finishTextEdit(false);record('Partial bold stays visible while a delayed text layout finishes');
  for(const font of ['gothic','myeongjo']){
   selAnno=id;await queueTextChange({font});const pdf=await buildEditedDocument([page]),actual=await render(await pdf.save());
   const ref=await PDFDocument.create(),fontData=await PDFMarkupText.load(font);ref.registerFontkit(fontkit);const embedded=await ref.embedFont(fontData.bytes,{subset:false}),rp=ref.addPage([a.pageWidth,a.pageHeight]);
   a.textLayout.lines.forEach((line,i)=>rp.drawText(line,{x:a.nx*a.pageWidth,y:a.pageHeight-a.ny*a.pageHeight-a.textLayout.ascent-i*a.textLayout.step,size:a.fontSize,font:embedded}));const expected=await render(await ref.save());
   assert(actual.text.includes('앞 일반 강조 ABC 마지막'),'Saved partial text is not searchable');
   const run=PDFMarkupText.lineRuns(a,0).find(r=>r.bold),x=(a.nx*a.pageWidth+run.x)*2,y=a.ny*a.pageHeight*2,box=[Math.ceil(x)+2,Math.floor(y),Math.floor(run.width*2)-4,Math.ceil(a.textLayout.height*2)];
   const plainInk=dark(expected.canvas,box),boldInk=dark(actual.canvas,box);assert(plainInk>50&&boldInk>plainInk*1.06,'Saved selected text is not visibly bolder: '+font+' '+boldInk+'/'+plainInk);
   const left=[Math.ceil(a.nx*a.pageWidth*2)+2,Math.floor(y),Math.floor(run.x*2)-6,Math.ceil(a.textLayout.height*2)],normal=dark(expected.canvas,left),unchanged=dark(actual.canvas,left);assert(Math.abs(normal-unchanged)<Math.max(10,normal*.03),'Unselected text was changed: '+font);
  }record('Saved Korean text remains searchable; only selected glyphs gain ink in both fonts');
  await preview(page);assert($('modalCanvas').width>0&&$('modalStatus').hidden,'Full-page preview failed');closeFullPreview();record('Full-page preview renders the formatted PDF');
  await openTextEditor(null,a);await queueTextChange({text:'가나다라마바사아자차카타파하\n다음 줄 ABC',fontSize:24,maxWidth:120});
  input.value=a.text;input.setSelectionRange(4,20);key();await textUpdate;const runs=a.textLayout.lines.flatMap((_,i)=>PDFMarkupText.lineRuns(a,i));assert(runs.some(r=>r.bold)&&runs.some(r=>!r.bold),'Wrapped range has no mixed formatting');
  await applyTextEditor();const wrapped=await render(await(await buildEditedDocument([page])).save());assert(wrapped.text.includes('다음'),'Wrapped text export lost a line');record('Partial bold follows wrapping and explicit line breaks');
  await openTextEditor(null,a);input.setSelectionRange(0,0);input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));await type('한'+input.value,0,0);input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await textUpdate;assert(!textComposing&&a.boldRanges.length,'Korean composition lost partial formatting');finishTextEdit(false);record('Korean composition keeps partial formatting and cancels safely');
  for(const rotation of [90,180,270]){
   const source=await PDFDocument.create(),rp=source.addPage([400,600]);rp.setCropBox(20,30,300,500);rp.setRotation(degrees(rotation));rp.node.set(PDFLib.PDFName.of('UserUnit'),PDFLib.PDFNumber.of(2));
   await loadFiles([new File([await source.save()],'Partial rotation '+rotation+'.pdf',{type:'application/pdf'})]);const current=pages.at(-1);await showPreview(current);await openTextEditor({x:.12,y:.2});await type('일반 강조 ABC');await queueTextChange({fontSize:24});input.setSelectionRange(3,5);key();await textUpdate;const t=textEditing.a;await applyTextEditor();
   const actual=await render(await(await buildEditedDocument([current])).save()),ranges=structuredClone(t.boldRanges);selAnno=t.id;await queueTextChange({bold:false});const plain=await render(await(await buildEditedDocument([current])).save());await queueTextChange({boldRanges:ranges});
   const run=PDFMarkupText.lineRuns(t,0).find(r=>r.bold),sx=actual.canvas.width/t.pageWidth,sy=actual.canvas.height/t.pageHeight,box=[Math.ceil((t.nx*t.pageWidth+run.x)*sx)+1,Math.floor(t.ny*actual.canvas.height),Math.floor(run.width*sx)-2,Math.ceil(t.textLayout.height*sy)];
   const normal=dark(plain.canvas,box),bold=dark(actual.canvas,box);assert(normal>30&&bold>normal*1.04&&actual.text.includes('강조'),'Partial bold export failed at '+rotation);
  }record('Partial bold stays positioned and searchable on rotated CropBox/UserUnit pages');
  const external=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name)&&new URL(e.name).origin!==location.origin);assert(!external.length,'External request');record('Partial formatting works with external connections blocked');
  out.textContent='PASS · '+checks.length+' partial bold checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e)}finally{if(parent!==window)parent.postMessage({rangeReport:out.textContent},location.origin)}
})();
