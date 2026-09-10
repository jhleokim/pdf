(async()=>{
 const out=$('textStyleChecks'),checks=[],assert=(v,m)=>{if(!v)throw Error(m)},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const record=m=>{checks.push(m);out.textContent=checks.join('\n')};
 const ink=(c,rect)=>{const ctx=c.getContext('2d'),d=rect?ctx.getImageData(...rect).data:ctx.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]<180&&d[i+1]<180&&d[i+2]<180)n++;return n};
 async function raster(target){const doc=await buildEditedDocument([target]),pdf=await pdfjsLib.getDocument({data:await doc.save(),...DOC_OPTS}).promise;try{const p=await pdf.getPage(1),vp=p.getViewport({scale:2}),canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;await p.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;return {canvas,content:(await p.getTextContent()).items.map(i=>i.str).join(' ')}}finally{await pdf.destroy()}}
 try{
  setProMode('basic');await insertBlankPage();const target=pages[0];if(isMobile()){setMobileView('preview');await showPreview(target);}else await setEditingFocus(true);
  await openTextEditor({x:.15,y:.2});$('textInput').value='검토   ABC\n문서   123';await queueTextChange({text:$('textInput').value,fontSize:24});const a=textEditing.a;
  const size=$('textSizeNumber').getBoundingClientRect(),minus=$('textSizeDown').getBoundingClientRect(),plus=$('textSizeUp').getBoundingClientRect();
  assert(minus.left>=size.right&&plus.left>=minus.right&&Math.abs(size.top-minus.top)<6,'Size buttons are not to the right of the number');
  for(let i=0;i<5;i++)$('textSizeUp').click();for(let i=0;i<2;i++)$('textSizeDown').click();await textUpdate;
  assert(a.fontSize===25.5&&$('textSizeNumber').value==='25.5','Rapid size clicks lost increments');record('Size buttons sit to the right and rapid clicks change exactly 0.5 pt');
  for(const limit of [8,96]){await queueTextChange({fontSize:limit});assert($(limit===8?'textSizeDown':'textSizeUp').disabled,'Size boundary is not disabled');$(limit===8?'textSizeDown':'textSizeUp').click();await textUpdate;assert(a.fontSize===limit,'Size boundary exceeded')}
  await queueTextChange({fontSize:24.5});assert($('textSize').value==='24.5'&&$('textSizeNumber').value==='24.5','Half-point size not retained');record('Size limits, numeric field and slider retain fractional points');
  $('textInput').focus();const focused=document.activeElement===$('textInput');for(const id of ['textBold','textItalic','textStrike'])$(id).click();await textUpdate;
  assert(a.bold&&a.italic&&a.strike&&(!focused||document.activeElement===$('textInput')),'Formatting lost concurrent changes or input focus');
  const css=getComputedStyle($('textInput'));assert(css.fontStyle==='italic'&&css.textDecorationLine==='line-through'&&css.fontWeight==='700','Input does not show emphasis');
  const toolbar=$('annoBar').getBoundingClientRect();for(const id of ['textFont','textSizeNumber','textSizeDown','textSizeUp','textBold','textItalic','textStrike','textApply']){const r=$(id).getBoundingClientRect();assert(r.left>=toolbar.left&&r.right<=toolbar.right+1&&r.bottom<=innerHeight,'Clipped control '+id)}
  await applyTextEditor();assert(Math.abs($('annoBar').getBoundingClientRect().height-toolbar.height)<1,'Applying text shifts toolbar height');
  assert(!$('pvOverlay').querySelector('.handle')&&$('pvOverlay').querySelector('.selbox'),'Text has image resize handles');record('B/I/S apply together, stay visible in the inline input and fit the toolbar');
  const selectedTop=$('pvCanvas').getBoundingClientRect().top;selAnno=null;renderAnnots();assert(Math.abs($('pvCanvas').getBoundingClientRect().top-selectedTop)<1,'Deselecting shifts the page under a double-click');selAnno=a.id;renderAnnots();
  const node=$('pvOverlay').querySelector('.anno'),firstText=node.querySelector('text');renderAnnots();renderAnnots();assert($('pvOverlay').querySelector('.anno')===node&&node.querySelector('text')===firstText,'Unchanged clicks replace the text target');
  assert(node.querySelectorAll('line').length===2&&+firstText.getAttribute('stroke-width')>0&&firstText.getAttribute('transform'),'SVG preview is missing styles');
  firstText.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));for(let i=0;i<100&&!textEditing;i++)await wait(20);assert(textEditing?.a===a&&$('textInput').value===a.text,'Double-click did not reopen text');
  $('textBold').click();$('textItalic').click();$('textStrike').click();await textUpdate;assert(!a.bold&&!a.italic&&!a.strike,'Styles cannot be turned off');finishTextEdit(false);assert(a.bold&&a.italic&&a.strike,'Cancel lost original formatting');record('Stable text nodes reopen on double-click; toggles and cancel retain the correct style');
  const c=$('pvCanvas'),r=c.getBoundingClientRect(),before={nw:a.nw,nh:a.nh,fontSize:a.fontSize,nx:a.nx,ny:a.ny};
  const point=(type,x,y,el=$('pvOverlay'))=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:42,button:0,clientX:r.left+x*r.width,clientY:r.top+y*r.height}));
  point('pointerdown',a.nx+.02,a.ny+.01,$('pvOverlay').querySelector('.anno rect'));point('pointermove',a.nx+.07,a.ny+.04);point('pointerup',a.nx+.07,a.ny+.04);
  assert(a.nx>before.nx&&a.ny>before.ny&&a.nw===before.nw&&a.nh===before.nh&&a.fontSize===before.fontSize,'Moving stretches text');
  const shape={id:'style-rect',shape:'rect',nx:.1,ny:.65,nw:.2,nh:.1,stroke:'#222222',fill:'none',lineWidth:1,opacity:1};curAnnots().push(shape);selAnno=shape.id;renderAnnots();assert($('pvOverlay').querySelectorAll('.handle').length===4,'Non-text resize handles removed');curAnnots().pop();selAnno=a.id;renderAnnots();record('Dragging moves text without stretching; other markup keeps resize handles');
  await queueTextChange({bold:false,italic:false,strike:false});const regular=await raster(target);
  await queueTextChange({bold:true});const bold=await raster(target);assert(ink(bold.canvas)>ink(regular.canvas)*1.15,'Bold does not increase exported ink');
  await queueTextChange({bold:false,italic:true});const italic=await raster(target),normalPixels=regular.canvas.getContext('2d').getImageData(0,0,regular.canvas.width,regular.canvas.height).data,italicPixels=italic.canvas.getContext('2d').getImageData(0,0,italic.canvas.width,italic.canvas.height).data;
  let changed=0;for(let i=0;i<normalPixels.length;i+=4)if(Math.abs(normalPixels[i]-italicPixels[i])>100)changed++;assert(changed>300&&ink(italic.canvas)>ink(regular.canvas)*.85,'Italic does not change exported glyphs');record('Saved PDF has measurably heavier bold and slanted italic glyphs');
  await queueTextChange({italic:false,strike:true});const struck=await raster(target),scale=struck.canvas.width/a.pageWidth;
  const band=[Math.floor(a.nx*struck.canvas.width),Math.floor(a.ny*struck.canvas.height+(a.textLayout.ascent-a.fontSize*.3)*scale)-2,Math.floor(a.nw*struck.canvas.width),5];
  assert(ink(struck.canvas,band)>ink(regular.canvas,band)+band[2]*.6,'Strike is not visible across word spaces');assert(struck.content.includes('ABC')&&struck.content.includes('123')&&bold.content.includes('검토')&&italic.content.includes('문서'),'Styles broke searchable text');record('Strikethrough crosses word spaces and styled Korean/English remain searchable');
  for(const rotation of [0,90,180,270]){
   const source=await PDFDocument.create(),page=source.addPage([400,600]);page.setCropBox(20,30,300,500);page.setRotation(degrees(rotation));page.node.set(PDFLib.PDFName.of('UserUnit'),PDFLib.PDFNumber.of(2));
   await loadFiles([new File([await source.save()],'Styled geometry.pdf',{type:'application/pdf'})]);const p=pages.at(-1);await showPreview(p);await openTextEditor({x:.15,y:.2});$('textInput').value='회전   ABC';await queueTextChange({text:$('textInput').value,fontSize:24,bold:true,italic:true,strike:true,font:rotation%180===0?'gothic':'myeongjo'});const t=textEditing.a;await applyTextEditor();
   const rendered=await raster(p),cv=rendered.canvas,x=Math.floor(t.nx*cv.width)-2,y=Math.floor(t.ny*cv.height)-2,w=Math.ceil(t.nw*cv.width)+12,h=Math.ceil(t.nh*cv.height)+4;
   assert(ink(cv,[x,y,w,h])>50&&rendered.content.includes('회전'),'Styled rotated text missing '+rotation);
   const factor=cv.width/t.pageWidth,lineY=Math.round(t.ny*cv.height+(t.textLayout.ascent-t.fontSize*.3)*factor),lineWidth=Math.floor(t.nw*cv.width);
   assert(ink(cv,[Math.floor(t.nx*cv.width),lineY-1,lineWidth,3])>lineWidth*.7,'Rotated strikethrough misplaced '+rotation);
  }record('Both font families, four rotations, CropBox and UserUnit preserve all styles');
  await showPreview(target);selAnno=a.id;await queueTextChange({bold:true,italic:true,strike:true});await preview(target);assert(ink($('modalCanvas'))>80,'Whole-page preview lost styled text');closeFullPreview();
  $('proOptimize').checked=false;setProMode('pro');for(let i=0;i<400&&$('proCompare').getAttribute('aria-busy')==='true';i++)await wait(30);assert(!$('proCompare').hasAttribute('data-error')&&ink($('compareAfter'))>30,'Pro preview lost styled text');setProMode('basic');record('Styled text appears in Basic and Pro whole-page previews');
  await showPreview(target);selAnno=a.id;await openTextEditor(null,a);await queueTextChange({font:'myeongjo',fontSize:22.5});await applyTextEditor();const saved=await raster(target);assert(saved.content.includes('검토')&&a.bold&&a.italic&&a.strike&&a.fontSize===22.5,'Font/size change lost styles');record('Changing font family and size preserves emphasis and searchable export');
  await openTextEditor(null,a);const originalLayout=a.textLayout;await queueTextChange({bold:false});$('textInput').focus();$('textInput').setSelectionRange(1,3);const hadFocus=document.activeElement===$('textInput'),value=$('textInput').value;
  $('textBold').click();assert(a.bold&&getComputedStyle($('textInput')).fontWeight==='700'&&a.textLayout===originalLayout&&!textEditPending,'Bold waits for layout instead of painting immediately');
  assert($('textInput').value===value&&$('textInput').selectionStart===1&&$('textInput').selectionEnd===3&&(!hadFocus||document.activeElement===$('textInput')),'Bold changed the draft, selection or focus');
  $('textBold').click();assert(!a.bold&&getComputedStyle($('textInput')).fontWeight==='400','Bold off is not immediate');finishTextEdit(false);record('Bold paints on/off in the click event without moving the caret or recalculating layout');
  const relayout=relayoutText;let release;
  try{
   await openTextEditor(null,a);let gate=new Promise(r=>release=r);relayoutText=async next=>{await gate;return relayout(next)};
   $('textInput').value='입력 동기화 ABC 123';const pending=queueTextChange({text:$('textInput').value,fontSize:23.5});$('textBold').click();const expectedBold=a.bold;
   assert(getComputedStyle($('textInput')).fontWeight===(expectedBold?'700':'400')&&textEditPending,'Pending layout blocks live bold');
   let done=false;const apply=applyTextEditor().then(()=>done=true);await wait(20);assert(textEditing&&!done,'Style change replaced the promise for unsaved input');
   release();await pending;await apply;assert(!textEditing&&a.text==='입력 동기화 ABC 123'&&a.fontSize===23.5&&a.bold===expectedBold,'Pending input overwrote bold or Apply lost the draft');
   relayoutText=relayout;await openTextEditor(null,a);const snapshot=structuredClone(a);gate=new Promise(r=>release=r);relayoutText=async next=>{await gate;return relayout(next)};
   const canceled=queueTextChange({text:'취소한 입력'});$('textBold').click();finishTextEdit(false);release();await canceled;await textUpdate;assert(a.text===snapshot.text&&a.bold===snapshot.bold,'Canceled delayed input restored a stale style');
  }finally{release?.();relayoutText=relayout;}
  record('Slow text layout cannot delay bold, bypass Apply waiting or overwrite cancellation');
  await openTextEditor(null,a);$('textInput').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));$('textInput').value='한글 조합 중';const composingText=queueTextChange({text:$('textInput').value});
  $('textBold').click();assert(textComposing&&$('textApply').disabled&&$('textInput').value==='한글 조합 중'&&getComputedStyle($('textInput')).fontWeight===(a.bold?'700':'400'),'Live bold interrupted Korean composition');
  $('textInput').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));await composingText;await textUpdate;assert(!textComposing&&a.text==='한글 조합 중','Composition completion lost text');finishTextEdit(false);record('Bold updates during Korean composition without committing or replacing the draft');
  const external=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name)&&new URL(e.name).origin!==location.origin);assert(!external.length,'External font or service request');record('All styles work with external HTTP connections blocked');
  out.textContent='PASS · '+checks.length+' text-style checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e)}finally{if(parent!==window)parent.postMessage({textStyleReport:out.textContent},location.origin)}
})();
