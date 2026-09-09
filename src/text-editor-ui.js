/* One inspector contains the draft, formatting and explicit page application. */
let textComposing=false,textPanelPosition=null,textPanelDrag=null;
function syncTextEditorUI(){
  if(!textEditing)return;
  const input=$('textInput'),error=$('textError').textContent,pending=textEditPending||textComposing;
  $('textApply').disabled=pending||!!error||!input.value.trim();
  input.setAttribute('aria-invalid',String(!!error));
  $('textCharCount').textContent=input.value.length.toLocaleString()+' / 2,000';
  $('textPreviewState').textContent=error?'입력 내용을 확인해 주세요':pending?'미리보기 반영 중…':input.value.trim()?'문서에 미리 표시 중':'텍스트를 입력하세요';
  $('textFormatSummary').textContent=PDFMarkupText.families[textStyle.font].name+' · '+textStyle.fontSize+' pt';
  $('textEditor').setAttribute('aria-busy',String(textEditPending));
}
function openTextEditorUI(){
  textComposing=false;textPanelPosition=null;
  $('textEditorTitle').textContent=textEditing.snapshot?'텍스트 수정':'텍스트 추가';
  $('textEditorPage').textContent=(pages.indexOf(textEditing.page)+1)+'페이지';
  $('textEditorFormat').appendChild($('annoTextProperties'));
  $('textEdit').hidden=true;$('textFormatDetails').open=innerWidth>880;
  syncTextEditorUI();
}
function closeTextEditorUI(){
  const restoreFocus=$('textEditor').contains(document.activeElement);
  textComposing=false;textPanelPosition=null;textPanelDrag=null;
  $('textPropertiesHome').appendChild($('annoTextProperties'));$('textEdit').hidden=false;
  if(restoreFocus)document.querySelector('[data-tool="text"]').focus({preventScroll:true});
}
function positionTextEditorPanel(){
  if(!textEditing)return;
  const panel=$('textEditor'),v=window.visualViewport;
  const left=v?.offsetLeft||0,top=v?.offsetTop||0,width=v?.width||innerWidth,height=v?.height||innerHeight;
  const w=Math.min(368,width-24),right=left+width,bottom=top+height;
  panel.style.width=w+'px';panel.style.maxHeight=Math.max(140,height-24)+'px';
  const h=panel.offsetHeight,r=$('pvCanvas').getBoundingClientRect();
  let x,y;
  if(innerWidth<=880){x=left+(width-w)/2;y=bottom-h-12;}
  else if(textPanelPosition){({x,y}=textPanelPosition);}
  else{
    x=r.left-left>=w+30?r.left-w-18:r.right+w+30<=right?r.right+18:right-w-16;
    y=Math.max(top+16,$('annoBar').getBoundingClientRect().top);
  }
  panel.style.left=clamp(x,left+12,Math.max(left+12,right-w-12))+'px';
  panel.style.top=clamp(y,top+12,Math.max(top+12,bottom-h-12))+'px';
}
async function applyTextEditor(){
  const session=textEditing;if(!session||textComposing||!$('textInput').value.trim())return;
  await textUpdate;if(session!==textEditing||textComposing)return;
  if(finishTextEdit(true))toast('텍스트를 페이지에 적용했습니다');
}
$('textApply').onclick=applyTextEditor;
$('textCancelClose').onclick=()=>finishTextEdit(false);
$('textInput').addEventListener('compositionstart',()=>{textComposing=true;syncTextEditorUI();});
$('textInput').addEventListener('compositionend',()=>{textComposing=false;void queueTextChange({text:$('textInput').value});});
$('textSizeNumber').oninput=e=>{
  const n=Number(e.target.value);if(e.target.value.trim()&&Number.isFinite(n)&&n>=8&&n<=96)void queueTextChange({fontSize:n});
};
$('textSizeNumber').onchange=e=>{const n=clamp(Number(e.target.value)||textStyle.fontSize,8,96);e.target.value=n;void queueTextChange({fontSize:n});};
$('textSizeNumber').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}};
$('textFormatDetails').addEventListener('toggle',positionTextEditor);
new ResizeObserver(positionTextEditor).observe($('textEditor'));
window.visualViewport?.addEventListener('resize',positionTextEditor);
window.visualViewport?.addEventListener('scroll',positionTextEditor);
$('textEditorGrip').addEventListener('pointerdown',e=>{
  if(innerWidth<=880||e.button!==0||e.target.closest('button'))return;
  const r=$('textEditor').getBoundingClientRect();textPanelDrag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};
  e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();
});
$('textEditorGrip').addEventListener('pointermove',e=>{
  const d=textPanelDrag;if(!d||d.id!==e.pointerId)return;
  textPanelPosition={x:d.left+e.clientX-d.x,y:d.top+e.clientY-d.y};positionTextEditor();
});
for(const name of ['pointerup','pointercancel','lostpointercapture'])$('textEditorGrip').addEventListener(name,()=>{textPanelDrag=null;});
