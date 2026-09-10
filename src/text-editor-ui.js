/* Text is edited on the page; formatting stays in the document toolbar. */
let textComposing=false;
let editingFocusZoom=1;
async function setEditingFocus(enabled){
  if(document.body.classList.contains('editing-focus')===enabled)return;
  await textUpdate;if(!finishTextEdit(true))return;
  if(enabled){editingFocusZoom=pvZoom;pvZoom=1;}else pvZoom=editingFocusZoom;
  document.body.classList.toggle('editing-focus',enabled);
  $('pvExpand').title=enabled?'편집 화면 줄이기':'편집 화면 크게';
  $('pvExpand').setAttribute('aria-pressed',String(enabled));
  const page=pages.find(p=>p.uid===previewUid);if(page)await showPreview(page);
}
$('pvExpand').title='편집 화면 크게';
$('pvExpand').onclick=()=>{if(isMobile()){const page=pages.find(p=>p.uid===previewUid);if(page)preview(page);}else void setEditingFocus(!document.body.classList.contains('editing-focus'));};
function syncTextEditorUI(){
  if(!$('textEditorActions'))return;
  const editing=!!textEditing;
  $('textEditorActions').hidden=!editing;$('textEdit').hidden=editing;
  $('textSizeValue').textContent=textStyle.fontSize+' pt';
  if(!editing)return;
  const invalid=!!$('textError').textContent;
  $('textApply').disabled=textEditPending||textComposing||invalid||!$('textInput').value.trim();
  $('textInput').setAttribute('aria-invalid',String(invalid));
  positionTextEditorPanel();
}
async function prepareInlineTextView(page,size,pageWidth){
  const pixels=size*$('pvCanvas').clientWidth/pageWidth,target=isMobile()?16:12;
  if(pixels>0&&pixels<target&&pvZoom<4){
    pvZoom=Math.min(4,pvZoom*target/pixels);await showPreview(page);
  }
}
function openTextEditorUI(){
  textComposing=false;$('pvStage').appendChild($('textEditor'));
  $('textFormatDetails').open=false;syncTextEditorUI();
  requestAnimationFrame(revealInlineText);
}
function closeTextEditorUI(){
  textComposing=false;$('textFormatDetails').open=false;
  $('textEditorActions').hidden=true;$('textEdit').hidden=false;$('textError').textContent='';
}
function positionTextEditorPanel(){
  if(!textEditing)return;
  const a=textEditing.a,c=$('pvCanvas'),input=$('textInput'),box=$('textEditor');
  if(!c.clientWidth||!a.textLayout)return;
  const sx=a.nw*c.clientWidth/a.textLayout.width,sy=a.nh*c.clientHeight/a.textLayout.height;
  const width=Math.max(a.maxWidth*sx,a.nw*c.clientWidth,48);
  box.style.left=(a.nx*c.clientWidth-3)+'px';box.style.top=(a.ny*c.clientHeight-3)+'px';
  box.style.width=(width+6)+'px';
  input.style.fontFamily=PDFMarkupText.families[a.font].family;
  input.style.fontSize=(a.fontSize*sy)+'px';input.style.lineHeight=(a.textLayout.step*sy)+'px';
  input.style.color=a.color;input.style.caretColor=a.color;
  // Match the PDF's synthetic weight and slant using the same embedded face.
  input.style.webkitTextStroke=a.bold?(a.fontSize*sy*PDFMarkupText.boldStroke)+'px '+a.color:'0px';
  input.style.fontStyle=a.italic?'italic':'normal';
  input.style.textDecorationLine=a.strike?'line-through':'none';
  input.style.textDecorationThickness=(a.fontSize*sy*PDFMarkupText.strikeWidth)+'px';
  input.style.width=(width/(sx/sy))+'px';input.style.transform='scaleX('+(sx/sy)+')';
  input.style.height='0px';input.style.height=Math.max(input.scrollHeight,a.nh*c.clientHeight,a.fontSize*sy*1.3)+'px';
  box.style.height=(parseFloat(input.style.height)+6)+'px';
}
function revealInlineText(){
  if(!textEditing)return;positionTextEditor();
  const input=$('textEditor').getBoundingClientRect(),body=$('pvBody'),r=body.getBoundingClientRect(),v=window.visualViewport;
  const bottom=Math.min(r.bottom,(v?.offsetTop||0)+(v?.height||innerHeight));
  if(input.top<r.top+20||input.bottom>bottom-20)body.scrollTop+=input.top-r.top-Math.max(20,(bottom-r.top)/3);
  if(input.left<r.left+12||input.right>r.right-12)body.scrollLeft+=input.left-r.left-20;
}
async function applyTextEditor(){
  const session=textEditing;if(!session||textComposing||!$('textInput').value.trim())return;
  await textUpdate;if(session!==textEditing||textComposing)return;
  if(finishTextEdit(true))$('textEdit').focus({preventScroll:true});
}
$('textApply').onclick=applyTextEditor;
$('textInput').addEventListener('compositionstart',()=>{textComposing=true;syncTextEditorUI();});
$('textInput').addEventListener('compositionend',()=>{textComposing=false;void queueTextChange({text:$('textInput').value});});
$('textSizeNumber').oninput=e=>{
  const n=Number(e.target.value);if(e.target.value.trim()&&Number.isFinite(n)&&n>=8&&n<=96)void queueTextChange({fontSize:n});
};
$('textSizeNumber').onchange=e=>{const n=clamp(Number(e.target.value)||textStyle.fontSize,8,96);e.target.value=n;void queueTextChange({fontSize:n});};
$('textSizeNumber').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}};
for(const [id,delta] of [['textSizeDown',-.5],['textSizeUp',.5]]){
  $(id).onpointerdown=e=>e.preventDefault();
  $(id).onclick=()=>{const n=Math.round(clamp(currentTextStyle().fontSize+delta,8,96)*100)/100;$('textSizeNumber').value=n;void queueTextChange({fontSize:n});};
}
for(const [id,key] of [['textBold','bold'],['textItalic','italic'],['textStrike','strike']]){
  $(id).onpointerdown=e=>e.preventDefault();
  $(id).onclick=()=>void queueTextChange({[key]:!currentTextStyle()[key]});
}
window.visualViewport?.addEventListener('resize',revealInlineText);
new ResizeObserver(positionTextEditor).observe($('pvCanvas').parentElement);
document.addEventListener('pointerdown',e=>{
  if(!$('textFormatDetails').contains(e.target))$('textFormatDetails').open=false;
  for(const menu of document.querySelectorAll('.markup-menu[open]'))if(!menu.contains(e.target))menu.open=false;
});
document.addEventListener('keydown',e=>{
  if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,dialog')||document.querySelector('dialog[open]')||$('modal').classList.contains('open')||document.body.classList.contains('is-busy')||!previewUid||proMode!=='basic')return;
  const tool={v:'none',t:'text',h:'highlight'}[e.key.toLowerCase()];
  if(tool){e.preventDefault();setTool(tool);if(tool!=='none'&&!isMobile())void setEditingFocus(true);}
});
