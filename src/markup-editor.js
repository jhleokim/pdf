const textStyle={font:'gothic',fontSize:16,lineGap:1.3,color:'#222222'};
let textEditing=null,textOpening=false,textEditPending=false,textUpdate=Promise.resolve();
const pendingTextChanges=new WeakMap();
function textSelection(){return curAnnots().find(a=>a.id===selAnno&&a.shape==='text');}
function syncTextControls(){
  const a=textSelection(),active=annoStyle.tool==='text'||!!a;
  $('annoTextProperties').hidden=!active;
  $('textPropertiesHome').hidden=!active;
  for(const key of ['font','fontSize','lineGap','color'])if(a)textStyle[key]=a[key];
  $('textFont').value=textStyle.font;$('textSize').value=textStyle.fontSize;
  if(document.activeElement!==$('textSizeNumber'))$('textSizeNumber').value=textStyle.fontSize;
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
    const snapshot=existing?structuredClone(a):null;
    if(!existing){await relayoutText(a);(page.annots||=[]).push(a);}
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
  const a=textSelection();for(const key of ['font','fontSize','lineGap','color'])if(key in change)textStyle[key]=change[key];if(!a){syncTextControls();return;}
  const revision=++textChangeRevision,next={...(pendingTextChanges.get(a)||a),...change};pendingTextChanges.set(a,next);textEditPending=true;$('textApply').disabled=true;
  if(typeof syncTextEditorUI==='function')syncTextEditorUI();
  try{
    await relayoutText(next);if(revision!==textChangeRevision||!curAnnots().includes(a))return;
    Object.assign(a,next);$('textError').textContent='';
    if(textEditing)$('textInput').style.fontFamily=PDFMarkupText.families[a.font].family;
    renderAnnots();syncCounts();
  }catch(e){if(revision===textChangeRevision){if(textEditing)$('textError').textContent=e.message;else toast(e.message,true);}}
  finally{if(revision===textChangeRevision){textEditPending=false;$('textApply').disabled=false;if(typeof syncTextEditorUI==='function')syncTextEditorUI();}}
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
$('pvOverlay').addEventListener('dblclick',e=>{const uid=e.target.closest('.anno')?.dataset.uid,a=curAnnots().find(x=>x.id===uid&&x.shape==='text');if(a){e.preventDefault();openTextEditor(null,a);}});
window.addEventListener('resize',positionTextEditor);$('pvBody').addEventListener('scroll',positionTextEditor);

/* A draggable page action uses the same board insertion point as page reordering. */
let blankPointer=null,blankClickUntil=0;
function blankDragClickBlocked(){return Date.now()<blankClickUntil;}
function captureBoardPositions(){return new Map(pages.filter(p=>p.el).map(p=>[p.uid,p.el.getBoundingClientRect()]));}
function animateBoardFrom(before,addedUid){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  for(const p of pages){
    const old=before.get(p.uid),r=p.el.getBoundingClientRect();
    if(old){const dx=old.left-r.left,dy=old.top-r.top;if(Math.abs(dx)+Math.abs(dy)>1)p.el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:180,easing:'ease-out'});}
    else if(p.uid===addedUid)p.el.animate([{opacity:0,transform:'scale(.94)'},{opacity:1,transform:'scale(1)'}],{duration:220,easing:'ease-out'});
  }
}
function updateBlankMarker(x,y){
  const wrap=$('boardWrap'),r=wrap.getBoundingClientRect();
  if(wrap.hidden||x<r.left||x>r.right||y<r.top||y>r.bottom){marker.remove();cancelAnimationFrame(scrollRaf);return;}
  const after=cardAfter(x,y);
  if(marker.parentNode===board&&marker.nextElementSibling===after)return;
  const before=captureBoardPositions();
  after?board.insertBefore(marker,after):board.appendChild(marker);animateBoardFrom(before);
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
  if(active){blankClickUntil=Date.now()+500;d.ghost?.remove();marker.remove();marker.classList.remove('blank-insertion');marker.innerHTML='';document.body.classList.remove('blank-dragging');}
  try{d.button.releasePointerCapture(d.id);}catch(_){}
  if(active&&commit&&inside)insertBlankPage({beforeUid});
}
document.addEventListener('pointerup',e=>{if(blankPointer?.id===e.pointerId)endBlankDrag(true);});
document.addEventListener('pointercancel',e=>{if(blankPointer?.id===e.pointerId)endBlankDrag(false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')endBlankDrag(false);});
window.addEventListener('blur',()=>endBlankDrag(false));
syncAnnotationControls();
