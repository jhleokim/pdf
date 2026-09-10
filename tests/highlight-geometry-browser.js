(async()=>{
 const out=$('geometryChecks'),checks=[],assert=(v,m)=>{if(!v)throw Error(m)},record=m=>{checks.push(m);out.textContent=checks.join('\n')};
 const lines=[
  {text:'제32조제4항, 제34조제9항부터 제11항까지의 개정규정은 이 법 시행 이후',font:'gothic',size:12,y:690},
  {text:'체결하는 계약부터 적용한다.',font:'gothic',size:12,y:664},
  {text:'가나다라마바사아자차카타파하가나다라마바사아자차카타파하',font:'myeongjo',size:14,y:600},
  {text:'DOCUMENT REVIEW 2026 — Highlight selection and PDF export',font:'gothic',size:13,y:540}
 ];
 const fonts={};let sourceBytes;
 const spanFor=line=>[...highlightLayer.querySelectorAll('span')].find(s=>s.textContent===line.text);
 function choose(start,end,from=0,to=end.textContent.length,reverse=false){
  const selection=getSelection();selection.removeAllRanges();
  if(reverse)selection.setBaseAndExtent(end.firstChild,to,start.firstChild,from);
  else{const range=document.createRange();range.setStart(start.firstChild,from);range.setEnd(end.firstChild,to);selection.addRange(range);}
 }
 function fullWidth(line){return fonts[line.font].widthOfTextAtSize(line.text,line.size);}
 function near(actual,expected,message,tolerance=.8){assert(Math.abs(actual-expected)<tolerance,message+': '+actual.toFixed(3)+' vs '+expected.toFixed(3));}
 async function show(page,zoom=1){pvZoom=zoom;await showPreview(page);setTool('highlight');}
 function expectedRect(vp,left,right,y){
  const a=vp.convertToViewportPoint(left,y),b=vp.convertToViewportPoint(right,y);
  return {start:vp.rotation%180?Math.min(a[1],b[1]):Math.min(a[0],b[0]),end:vp.rotation%180?Math.max(a[1],b[1]):Math.max(a[0],b[0])};
 }
 try{
  setProMode('basic');await PDFMarkupText.load('gothic');const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  for(const family of ['gothic','myeongjo'])fonts[family]=await pdf.embedFont((await PDFMarkupText.load(family)).bytes,{subset:false});
  const page=pdf.addPage([595,842]);for(const line of lines)page.drawText(line.text,{x:54,y:line.y,font:fonts[line.font],size:line.size});
  sourceBytes=await pdf.save();await loadFiles([new File([sourceBytes],'Highlight endpoints.pdf',{type:'application/pdf'})]);const original=pages[0];
  if(isMobile())setMobileView('preview');else await setEditingFocus(true);
  for(const zoom of [.75,1,2.5]){
   await show(original,zoom);const bounds=$('pvCanvas').getBoundingClientRect(),scale=bounds.width/595;
   for(const line of lines){
    const span=spanFor(line);assert(span,'Missing selectable line');const r=span.getBoundingClientRect();
    near((r.left-bounds.left)/scale,54,'Line start at zoom '+zoom);
    near((r.right-bounds.left)/scale,54+fullWidth(line),'Line end at zoom '+zoom+' / '+line.text);
   }
  }record('Long Korean, mixed numeric and English lines match independent PDF font widths at three zoom levels');
  await show(original);const first=spanFor(lines[0]),second=spanFor(lines[1]),third=spanFor(lines[2]);
  choose(first,second);applySelectedHighlight();const multi=curAnnots().at(-1);
  assert(multi.quads.length===2,'Multiple lines became one large rectangle');
  multi.quads.forEach((q,i)=>near((multi.nx+(q.x+q.w)*multi.nw)*595,54+fullWidth(lines[i]),'Multiline endpoint '+i));
  record('Multi-line highlighting follows each line’s own final character');
  choose(third,third,4,23);applySelectedHighlight();const partial=curAnnots().at(-1),font=fonts[lines[2].font],size=lines[2].size;
  near(partial.nx*595,54+font.widthOfTextAtSize(lines[2].text.slice(0,4),size),'Partial selection start');
  near((partial.nx+partial.nw)*595,54+font.widthOfTextAtSize(lines[2].text.slice(0,23),size),'Partial selection end');
  choose(third,third,4,23,true);applySelectedHighlight();const reverse=curAnnots().at(-1);
  near(reverse.nx,partial.nx,'Reverse start',1e-5);near(reverse.nw,partial.nw,'Reverse width',1e-5);
  await requestEditUndo();await requestEditUndo(true);near(curAnnots().at(-1).nw,partial.nw,'Undo/redo selection width',1e-5);
  record('Partial text, reverse selection and undo/redo retain the same endpoints');
  const originalGeometry=JSON.stringify(original.annots);await show(original,2.5);assert(JSON.stringify(original.annots)===originalGeometry,'Zoom changed stored geometry');
  record('Zoom changes preserve the saved highlight geometry');
  for(const rotation of [0,90,180,270]){
   const rotated=await PDFDocument.load(sourceBytes),rp=rotated.getPage(0);rp.setCropBox(20,30,555,782);rp.setRotation(degrees(rotation));rp.node.set(PDFLib.PDFName.of('UserUnit'),PDFLib.PDFNumber.of(2));
   await loadFiles([new File([await rotated.save()],'Rotation '+rotation+'.pdf',{type:'application/pdf'})]);const current=pages.at(-1);await show(current);
   const p=await docs.get(current.docId).pdfjsDoc.getPage(1),span=spanFor(lines[0]),bounds=$('pvCanvas').getBoundingClientRect(),vp=p.getViewport({scale:bounds.width/p.getViewport({scale:1}).width});
   const r=span.getBoundingClientRect(),expected=expectedRect(vp,54,54+fullWidth(lines[0]),lines[0].y),vertical=rotation%180;
   const axisScale=vertical?bounds.height/vp.height:bounds.width/vp.width;expected.start*=axisScale;expected.end*=axisScale;
   near(vertical?r.top-bounds.top:r.left-bounds.left,expected.start,'Rotated line start '+rotation,.9);
   near(vertical?r.bottom-bounds.top:r.right-bounds.left,expected.end,'Rotated line end '+rotation,.9);
   choose(span,span);applySelectedHighlight();const mark=curAnnots().at(-1),built=await buildEditedDocument([current]),saved=await pdfjsLib.getDocument({data:await built.save(),...DOC_OPTS}).promise;
   const savedPage=await saved.getPage(1),renderVP=savedPage.getViewport({scale:1.5}),canvas=document.createElement('canvas');canvas.width=Math.ceil(renderVP.width);canvas.height=Math.ceil(renderVP.height);await savedPage.render({canvasContext:canvas.getContext('2d'),viewport:renderVP}).promise;
   const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let min=Infinity,max=-Infinity;
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(pixels[i]>pixels[i+2]+20&&pixels[i+1]>pixels[i+2]+10){const at=vertical?y:x;min=Math.min(min,at);max=Math.max(max,at);}}
   const savedExpected=expectedRect(renderVP,54,54+fullWidth(lines[0]),lines[0].y);
   near(min,savedExpected.start,'Exported highlight first pixel '+rotation,2);near(max+1,savedExpected.end,'Exported highlight final pixel '+rotation,2);
   assert(mark.quads.length===1,'Rotated full line split unexpectedly');await saved.destroy();
  }record('Saved highlight pixels agree with PDF coordinates at 0/90/180/270°, including CropBox and UserUnit');
  const external=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name)&&new URL(e.name).origin!==location.origin);assert(!external.length,'External asset request');record('Text selection and export work with external HTTP connections blocked');
  out.textContent='PASS · '+checks.length+' highlight geometry checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e)}finally{if(parent!==window)parent.postMessage({geometryReport:out.textContent},location.origin)}
})();
