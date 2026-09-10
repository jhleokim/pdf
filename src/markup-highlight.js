/* Selectable PDF text supplies the highlight geometry; scans keep an area tool. */
const highlightStyle={color:'#f4d35e',opacity:.35};
let highlightMode='auto',highlightHasText=false,highlightLayerTask=null,highlightPointer=null;
const highlightTextCache=new WeakMap();
const highlightLayer=document.createElement('div');highlightLayer.id='pvTextLayer';highlightLayer.className='document-text-layer';highlightLayer.hidden=true;
$('pvStage').appendChild(highlightLayer);
function clearHighlightLayer(){
  highlightLayerTask?.cancel();highlightLayerTask=null;highlightPointer=null;highlightHasText=false;
  const selection=getSelection();if(selection?.anchorNode&&highlightLayer.contains(selection.anchorNode))selection.removeAllRanges();
  highlightLayer.replaceChildren();highlightLayer.hidden=true;
}
function alignHighlightTextWidths(textDivs,properties,viewport){
  // Canvas text measurement and DOM fallback-font layout can differ at fractional
  // zoom/DPI. Measure every run once in the DOM, then match its original PDF width.
  const canvas=$('pvCanvas'),sx=canvas.clientWidth/viewport.width,sy=canvas.clientHeight/viewport.height;
  // PDF.js rounds layer dimensions independently of the raster canvas. Keep the
  // logical page exact and fit both axes, including rotated mobile previews.
  highlightLayer.style.width=viewport.rawDims.pageWidth*viewport.scale+'px';
  highlightLayer.style.height=viewport.rawDims.pageHeight*viewport.scale+'px';
  const rotation={0:'',90:'rotate(90deg) translateY(-100%)',180:'rotate(180deg) translate(-100%,-100%)',270:'rotate(270deg) translateX(-100%)'}[viewport.rotation];
  highlightLayer.style.transform='scale('+sx+','+sy+') '+rotation;
  const runs=textDivs.map(div=>({div,properties:properties.get(div),transform:div.style.transform})).filter(run=>run.properties?.canvasWidth>0&&run.div.textContent);
  if(!runs.length)return;
  const hidden=highlightLayer.hidden,visibility=highlightLayer.style.visibility;
  try{
    highlightLayer.style.visibility='hidden';highlightLayer.hidden=false;
    for(const run of runs)run.div.style.transform='none';
    const widths=runs.map(({div})=>{const r=div.getBoundingClientRect();return viewport.rotation%180?r.height:r.width;});
    runs.forEach((run,i)=>{
      const width=widths[i],scale=run.properties.canvasWidth*viewport.scale*(viewport.rotation%180?sy:sx)/width;
      run.div.style.transform=width>0&&Number.isFinite(scale)?(run.properties.angle?'rotate('+run.properties.angle+'deg) ':'')+'scaleX('+scale+')':run.transform;
    });
  }finally{highlightLayer.hidden=hidden;highlightLayer.style.visibility=visibility;}
}
async function renderHighlightLayer(page,viewport,token){
  clearHighlightLayer();
  try{
    if(!highlightTextCache.has(page))highlightTextCache.set(page,page.getTextContent());
    const content=await highlightTextCache.get(page);
    if(token!==pvToken)return;
    highlightHasText=content.items.some(item=>item.str?.trim());
    if(highlightHasText){
      highlightLayer.style.setProperty('--scale-factor',viewport.scale);
      const textDivs=[],textDivProperties=new WeakMap();
      const task=pdfjsLib.renderTextLayer({textContentSource:content,container:highlightLayer,viewport,textDivs,textDivProperties,isOffscreenCanvasSupported:false});
      highlightLayerTask=task;await task.promise;
      if(token!==pvToken)return;
      alignHighlightTextWidths(textDivs,textDivProperties,viewport);
      if(highlightLayerTask===task)highlightLayerTask=null;
      if(!highlightLayer.querySelector('span'))highlightHasText=false;
    }
    syncHighlightControls();
  }catch(e){if(token===pvToken&&e.name!=='AbortException'){highlightHasText=false;syncHighlightControls();console.warn('텍스트 선택을 준비하지 못해 영역 강조를 사용합니다.');}}
}
function syncHighlightControls(){
  const selected=curAnnots().find(a=>a.id===selAnno);
  const active=annoStyle.tool==='highlight',show=active||selected?.shape==='highlight';
  $('highlightProperties').hidden=!show;
  $('highlightUndo').disabled=!curAnnots().some(a=>a.shape==='highlight');
  const textMode=highlightHasText&&highlightMode!=='area';
  $('highlightTextMode').disabled=!highlightHasText;
  $('highlightTextMode').title=highlightHasText?'문장을 드래그하여 강조':'이 페이지에는 선택 가능한 원본 텍스트가 없습니다';
  $('highlightTextMode').setAttribute('aria-pressed',String(textMode));
  $('highlightAreaMode').setAttribute('aria-pressed',String(!textMode));
  const color=selected?.shape==='highlight'?selected.fill:highlightStyle.color,opacity=selected?.shape==='highlight'?selected.opacity:highlightStyle.opacity;
  document.querySelectorAll('[data-highlight-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.highlightColor.toLowerCase()===color.toLowerCase())));
  $('highlightOpacity').value=Math.round(opacity*100);$('highlightOpacityValue').textContent=Math.round(opacity*100)+'%';
  highlightLayer.hidden=!active||!textMode||!!textEditing;
}
function setHighlightStyle(change){
  const history=typeof captureEditHistory==='function'?captureEditHistory():null;
  Object.assign(highlightStyle,change);
  annoStyle.fill=highlightStyle.color;annoStyle.opacity=highlightStyle.opacity;
  const a=curAnnots().find(x=>x.id===selAnno);
  if(a?.shape==='highlight'){a.fill=highlightStyle.color;a.opacity=highlightStyle.opacity;}
  renderAnnots();syncCounts();
  if(typeof commitEditHistory==='function')commitEditHistory(history,'형광펜 서식',change.opacity!==undefined?a?.id+':highlight-opacity':null);
}
$('highlightTextMode').onclick=()=>{highlightMode='text';syncHighlightControls();};
$('highlightAreaMode').onclick=()=>{highlightMode='area';syncHighlightControls();};
for(const b of document.querySelectorAll('[data-highlight-color]'))b.onclick=()=>setHighlightStyle({color:b.dataset.highlightColor});
$('highlightOpacity').oninput=e=>setHighlightStyle({opacity:Number(e.target.value)/100});
function undoLastHighlight(){
  const list=curAnnots(),index=list.findLastIndex(a=>a.shape==='highlight');if(index<0)return;
  const history=typeof captureEditHistory==='function'?captureEditHistory():null;
  if(selAnno===list[index].id)selAnno=null;list.splice(index,1);renderAnnots();syncCounts();
  if(typeof commitEditHistory==='function')commitEditHistory(history,'마지막 강조 삭제');
}
$('highlightUndo').onclick=undoLastHighlight;
function highlightFromRects(rectangles){
  const page=$('pvCanvas').getBoundingClientRect(),rects=[];
  for(const r of rectangles){
    const x=clamp(r.left,page.left,page.right),y=clamp(r.top,page.top,page.bottom),right=clamp(r.right,page.left,page.right),bottom=clamp(r.bottom,page.top,page.bottom);
    if(right-x<.5||bottom-y<.5)continue;
    rects.push({x,y,w:right-x,h:bottom-y});
  }
  rects.sort((a,b)=>a.y-b.y||a.x-b.x);
  const merged=[];
  for(const r of rects){
    const last=merged.at(-1);
    if(last&&Math.abs(last.y-r.y)<1&&Math.abs(last.h-r.h)<1&&r.x<=last.x+last.w+1.5)last.w=Math.max(last.x+last.w,r.x+r.w)-last.x;
    else merged.push({...r});
  }
  if(!merged.length)return null;
  const x=Math.min(...merged.map(r=>r.x)),y=Math.min(...merged.map(r=>r.y)),w=Math.max(...merged.map(r=>r.x+r.w))-x,h=Math.max(...merged.map(r=>r.y+r.h))-y;
  return {id:'a'+(++annoUidSeq),shape:'highlight',nx:(x-page.left)/page.width,ny:(y-page.top)/page.height,nw:w/page.width,nh:h/page.height,stroke:'none',lineWidth:0,dash:'solid',fill:highlightStyle.color,opacity:highlightStyle.opacity,
    quads:merged.map(r=>({x:(r.x-x)/w,y:(r.y-y)/h,w:r.w/w,h:r.h/h}))};
}
function applySelectedHighlight(){
  const selection=getSelection();
  if(annoStyle.tool!=='highlight'||highlightLayer.hidden||!selection?.rangeCount||selection.isCollapsed||!highlightLayer.contains(selection.anchorNode)||!highlightLayer.contains(selection.focusNode))return;
  const range=selection.getRangeAt(0),walker=document.createTreeWalker(highlightLayer,NodeFilter.SHOW_TEXT),rects=[];
  for(let node;node=walker.nextNode();){
    if(!node.textContent.trim()||!range.intersectsNode(node))continue;
    const part=document.createRange();part.selectNodeContents(node);
    if(range.compareBoundaryPoints(Range.START_TO_START,part)>0)part.setStart(range.startContainer,range.startOffset);
    if(range.compareBoundaryPoints(Range.END_TO_END,part)<0)part.setEnd(range.endContainer,range.endOffset);
    if(!part.collapsed)rects.push(...part.getClientRects());
  }
  const a=highlightFromRects(rects);if(!a)return;
  const history=typeof captureEditHistory==='function'?captureEditHistory():null;
  curAnnots().push(a);selAnno=null;selection.removeAllRanges();renderAnnots();syncCounts();
  if(typeof commitEditHistory==='function')commitEditHistory(history,'형광펜 추가');
}
highlightLayer.addEventListener('pointerdown',e=>{if(e.button===0)highlightPointer={id:e.pointerId,uid:previewUid};});
document.addEventListener('pointerup',e=>{
  if(highlightPointer?.id!==e.pointerId)return;const uid=highlightPointer.uid;highlightPointer=null;
  setTimeout(()=>{if(previewUid===uid)applySelectedHighlight();},0);
});
document.addEventListener('pointercancel',()=>{highlightPointer=null;});
function highlightToSVG(a,w,h){
  const g=document.createElementNS(SVGNS,'g');g.setAttribute('class','anno');g.dataset.uid=a.id;g.style.mixBlendMode='multiply';
  for(const q of a.quads){const rect=document.createElementNS(SVGNS,'rect');
    for(const [key,value] of Object.entries({x:(a.nx+q.x*a.nw)*w,y:(a.ny+q.y*a.nh)*h,width:q.w*a.nw*w,height:q.h*a.nh*h,fill:a.fill,'fill-opacity':a.opacity,stroke:'none'}))rect.setAttribute(key,value);
    g.appendChild(rect);
  }return g;
}
function bakeHighlight(page,a,viewport){
  const color=hexToRgb(a.fill||highlightStyle.color);
  for(const q of a.quads||[{x:0,y:0,w:1,h:1}]){
    const x=(a.nx+q.x*a.nw)*viewport.width,y=(a.ny+q.y*a.nh)*viewport.height,w=q.w*a.nw*viewport.width,h=q.h*a.nh*viewport.height;
    const points=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(p=>viewport.convertToPdfPoint(...p)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    page.drawRectangle({x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys),color:rgb(color.r,color.g,color.b),opacity:a.opacity,borderWidth:0,blendMode:PDFLib.BlendMode.Multiply});
  }
}
syncHighlightControls();
