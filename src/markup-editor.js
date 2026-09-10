const textStyle={font:'gothic',fontSize:16,lineGap:1.3,color:'#222222',bold:false,italic:false,strike:false};
let textEditing=null,textOpening=false,textEditPending=false,textUpdate=Promise.resolve();
const pendingTextChanges=new WeakMap();
function textSelection(){return curAnnots().find(a=>a.id===selAnno&&a.shape==='text');}
function currentTextStyle(){const a=textSelection();return a?(pendingTextChanges.get(a)||a):textStyle;}
function syncTextControls(){
  const a=textSelection(),active=annoStyle.tool==='text'||!!a;
  $('annoTextProperties').hidden=!active;
  $('textPropertiesHome').hidden=!active;
  const current=currentTextStyle();
  for(const key of ['font','fontSize','lineGap','color'])textStyle[key]=current[key];
  for(const [id,key] of [['textBold','bold'],['textItalic','italic'],['textStrike','strike']]){textStyle[key]=!!current[key];$(id).setAttribute('aria-pressed',String(textStyle[key]));}
  $('textFont').value=textStyle.font;$('textSize').value=textStyle.fontSize;
  if(document.activeElement!==$('textSizeNumber'))$('textSizeNumber').value=textStyle.fontSize;
  $('textSizeDown').disabled=textStyle.fontSize<=8;$('textSizeUp').disabled=textStyle.fontSize>=96;
  $('textLineGap').value=textStyle.lineGap;$('textLineGapVal').textContent=Math.round(textStyle.lineGap*100)+'%';$('textColor').value=textStyle.color;
  $('textEdit').disabled=!a;
  $('annoToolHint').textContent='';
  $('annoToolHint').hidden=!$('annoToolHint').textContent;
  if(typeof syncTextEditorUI==='function')syncTextEditorUI();
}
async function relayoutText(a){
  const {font}=await PDFMarkupText.load(a.font);
  a.text=PDFMarkupText.clean(a.text);
  const layout=PDFMarkupText.layout(font,a.text,a.fontSize,a.lineGap,a.maxWidth||a.pageWidth-16);
  if(layout.height>a.pageHeight-16)throw Error('텍스트가 페이지보다 깁니다. 글씨 크기를 줄이거나 텍스트 상자를 나누어 주세요.');
  a.textLayout=layout;a.nw=layout.width/a.pageWidth;a.nh=layout.height/a.pageHeight;
  a.nx=clamp(a.nx,0,Math.max(0,1-a.nw));a.ny=clamp(a.ny,0,Math.max(0,1-a.nh));
}
function positionTextEditor(){
  if(typeof positionTextEditorPanel==='function')return positionTextEditorPanel();
}
async function openTextEditor(point,existing){
  if(textOpening||document.body.classList.contains('is-busy'))return;
  if(!finishTextEdit(true))return;
  const page=pages.find(p=>p.uid===previewUid);if(!page)return;
  textOpening=true;
  try{
    const source=await docs.get(page.docId).pdfjsDoc.getPage(page.srcIndex+1);
    const vp=source.getViewport({scale:1,rotation:(source.rotate+page.rotation)%360}),unit=source.userUnit||1;
    await PDFMarkupText.load(existing?.font||textStyle.font);
    if(previewUid!==page.uid)return;
    if(typeof prepareInlineTextView==='function')await prepareInlineTextView(page,existing?.fontSize||textStyle.fontSize,vp.width*unit);
    if(previewUid!==page.uid)return;
    const a=existing||{id:'a'+(++annoUidSeq),shape:'text',...textStyle,text:'',nx:point.x,ny:point.y,pageWidth:vp.width*unit,pageHeight:vp.height*unit,maxWidth:Math.max(textStyle.fontSize*2,Math.min(vp.width*unit*.72,vp.width*unit*(1-point.x)-12))};
    if(!existing&&isMobile())a.maxWidth=Math.min(a.maxWidth,Math.max(textStyle.fontSize*2,($('pvBody').clientWidth-40)*a.pageWidth/$('pvCanvas').clientWidth));
    const snapshot=existing?{bold:false,italic:false,strike:false,...structuredClone(a)}:null;
    // Restore natural font proportions when reopening text from older versions.
    await relayoutText(a);if(!existing)(page.annots||=[]).push(a);
    textEditing={page,a,snapshot,revision:0};selAnno=a.id;setTool('none');
    $('textEditor').hidden=false;$('textInput').value=a.text;$('textInput').style.fontFamily=PDFMarkupText.families[a.font].family;
    $('textError').textContent='';$('textApply').disabled=false;
    if(typeof openTextEditorUI==='function')openTextEditorUI();
    renderAnnots();positionTextEditor();$('textInput').focus({preventScroll:true});
  }catch(e){toast(e.message||'텍스트 도구를 준비하지 못했습니다.',true);}finally{textOpening=false;}
}
function finishTextEdit(apply){
  if(!textEditing)return true;
  const {page,a,snapshot}=textEditing;
  if(apply&&textEditPending)return false;
  if(apply&&$('textError').textContent){$('textInput').focus();return false;}
  if(apply&&typeof textComposing!=='undefined'&&textComposing)return false;
  if(snapshot&&(!apply||!a.text.trim()))Object.assign(a,snapshot);
  else if(!apply||!a.text.trim()){const i=page.annots.indexOf(a);if(i>=0)page.annots.splice(i,1);if(selAnno===a.id)selAnno=null;}
  textChangeRevision++;textEditPending=false;pendingTextChanges.delete(a);
  textEditing=null;
  if(typeof closeTextEditorUI==='function')closeTextEditorUI();
  $('textEditor').hidden=true;$('textApply').disabled=false;renderAnnots();syncCounts();return true;
}
let textChangeRevision=0;
async function applyTextChange(change){
  const a=textSelection();for(const key of ['font','fontSize','lineGap','color','bold','italic','strike'])if(key in change)textStyle[key]=change[key];if(!a){syncTextControls();return;}
  if(Object.keys(change).every(key=>['bold','italic','strike','color'].includes(key))){
    // Paint-only controls take effect in this event, including during IME input.
    // Preserve an in-flight text/font layout and its promise so Apply still waits
    // for the latest typed content, without letting it overwrite the new style.
    const waiting=textUpdate,pending=pendingTextChanges.get(a);
    Object.assign(a,change);if(pending)Object.assign(pending,change);
    renderAnnots();syncCounts();return waiting;
  }
  const revision=++textChangeRevision,next={...(pendingTextChanges.get(a)||a),...change};pendingTextChanges.set(a,next);textEditPending=true;$('textApply').disabled=true;
  syncTextControls();
  try{
    await relayoutText(next);if(revision!==textChangeRevision||!curAnnots().includes(a))return;
    Object.assign(a,next);$('textError').textContent='';
    if(textEditing)$('textInput').style.fontFamily=PDFMarkupText.families[a.font].family;
    renderAnnots();syncCounts();
  }catch(e){if(revision===textChangeRevision){if(textEditing)$('textError').textContent=e.message;else toast(e.message,true);}}
  finally{if(revision===textChangeRevision){pendingTextChanges.delete(a);textEditPending=false;$('textApply').disabled=false;syncTextControls();}}
}
function queueTextChange(change){textUpdate=applyTextChange(change);return textUpdate;}
$('textInput').addEventListener('input',()=>queueTextChange({text:$('textInput').value}));
$('textApply').onclick=()=>finishTextEdit(true);$('textCancel').onclick=()=>finishTextEdit(false);
$('textEdit').onclick=()=>{const a=textSelection();if(a)openTextEditor(null,a);};
$('textInput').addEventListener('keydown',e=>{
  if(e.isComposing)return;
  if(e.key==='Escape'){e.preventDefault();finishTextEdit(false);}
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();if(typeof applyTextEditor==='function')void applyTextEditor();else finishTextEdit(true);}
});
$('textFont').onchange=e=>queueTextChange({font:e.target.value});
for(const id of ['textSize','textSizeNumber'])$(id).oninput=e=>queueTextChange({fontSize:clamp(Number(e.target.value)||16,8,96)});
$('textLineGap').oninput=e=>queueTextChange({lineGap:clamp(Number(e.target.value)||1.3,1,2)});
$('textColor').oninput=e=>queueTextChange({color:e.target.value});
$('pvOverlay').addEventListener('dblclick',e=>{const uid=e.target.closest('.anno')?.dataset.uid,a=curAnnots().find(x=>x.id===uid&&x.shape==='text');if(a&&annoStyle.tool==='none'){e.preventDefault();e.stopPropagation();openTextEditor(null,a);}});
window.addEventListener('resize',positionTextEditor);$('pvBody').addEventListener('scroll',positionTextEditor);

/* A draggable page action uses the same board insertion point as page reordering. */
let blankPointer=null,blankClickUntil=0;
const boardMotion=new Map();
function blankDragClickBlocked(){return Date.now()<blankClickUntil;}
function captureBoardPositions(){return new Map(pages.filter(p=>p.el).map(p=>[p.uid,p.el.getBoundingClientRect()]));}
function animateBoardFrom(before,addedUid){
  // Snapshot the visible positions first, then cancel old motion before measuring
  // the new layout. Retargeting from transformed bounds compounds the offset.
  for(const animation of boardMotion.values())animation.cancel();boardMotion.clear();
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const bounds=pages.map(p=>[p,p.el.getBoundingClientRect()]);
  for(const [p,r] of bounds){
    const old=before.get(p.uid);let frames;
    if(old){const dx=old.left-r.left,dy=old.top-r.top;if(Math.abs(dx)+Math.abs(dy)>.5)frames=[{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}];}
    else if(p.uid===addedUid)frames=[{opacity:0,transform:'scale(.97)'},{opacity:1,transform:'scale(1)'}];
    if(!frames)continue;
    const el=p.el,animation=el.animate(frames,{duration:180,easing:'cubic-bezier(.2,.7,.2,1)'});
    boardMotion.set(el,animation);
    animation.onfinish=()=>{if(boardMotion.get(el)===animation)boardMotion.delete(el);};
  }
}
function boardCardRect(el){
  const r=el.getBoundingClientRect();
  if(!boardMotion.has(el))return r;
  const t=new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return {left:r.left-t.m41,top:r.top-t.m42,bottom:r.bottom-t.m42,right:r.right-t.m41,width:r.width,height:r.height};
}
function placeBoardMarker(after){
  if(marker.parentNode===board&&marker.nextElementSibling===(after||null))return;
  const before=captureBoardPositions();after?board.insertBefore(marker,after):board.appendChild(marker);animateBoardFrom(before);
}
function removeBoardMarker(){
  if(!marker.parentNode)return;
  const before=captureBoardPositions();marker.remove();animateBoardFrom(before);
}
function updateBlankMarker(x,y){
  const wrap=$('boardWrap'),r=wrap.getBoundingClientRect();
  if(wrap.hidden||x<r.left||x>r.right||y<r.top||y>r.bottom){removeBoardMarker();cancelAnimationFrame(scrollRaf);return;}
  if(marker.parentNode===board){const m=marker.getBoundingClientRect();if(x>=m.left&&x<=m.right&&y>=m.top&&y<=m.bottom)return;}
  const after=cardAfter(x,y);
  placeBoardMarker(after);
}
function startBlankDrag(e){
  if(e.button!==0||e.isPrimary===false||document.body.classList.contains('is-busy'))return;
  blankPointer={id:e.pointerId,x:e.clientX,y:e.clientY,button:e.currentTarget,active:false};
  try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_){}
}
for(const id of ['btnBlank','mbBlank']){
  $(id).addEventListener('pointerdown',startBlankDrag);
  $(id).addEventListener('dragstart',e=>e.preventDefault());
}
document.addEventListener('pointermove',e=>{
  const d=blankPointer;if(!d||e.pointerId!==d.id)return;
  if(!d.active){
    if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<7)return;
    d.active=true;blankClickUntil=Date.now()+1000;
    d.ghost=document.createElement('div');d.ghost.className='blank-page-ghost';d.ghost.innerHTML='<svg class="ic"><use href="#i-blank-page"/></svg><span>빈 페이지</span>';document.body.appendChild(d.ghost);
    marker.classList.add('blank-insertion');marker.innerHTML='<svg class="ic"><use href="#i-blank-page"/></svg><span>여기에 추가</span>';
    document.body.classList.add('blank-dragging');
  }
  d.ghost.style.transform=`translate(${e.clientX+14}px,${e.clientY-35}px)`;
  d.clientX=e.clientX;d.clientY=e.clientY;
  updateBlankMarker(e.clientX,e.clientY);
  if(marker.parentNode===board)autoScroll(e.clientY);
});
function endBlankDrag(commit){
  const d=blankPointer;if(!d)return;
  const active=d.active,beforeUid=marker.nextElementSibling?.dataset.uid||null,inside=marker.parentNode===board;
  blankPointer=null;cancelAnimationFrame(scrollRaf);
  if(active){blankClickUntil=Date.now()+500;d.ghost?.remove();removeBoardMarker();marker.classList.remove('blank-insertion');marker.innerHTML='';document.body.classList.remove('blank-dragging');}
  try{d.button.releasePointerCapture(d.id);}catch(_){}
  if(active&&commit&&inside)insertBlankPage({beforeUid});
}
document.addEventListener('pointerup',e=>{if(blankPointer?.id===e.pointerId)endBlankDrag(true);});
document.addEventListener('pointercancel',e=>{if(blankPointer?.id===e.pointerId)endBlankDrag(false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')endBlankDrag(false);});
window.addEventListener('blur',()=>endBlankDrag(false));
syncAnnotationControls();
