/* Keyboard and touch alternatives share the existing reorder/undo transaction. */
board.setAttribute('role','list');board.setAttribute('aria-label','문서 페이지');
const documentHistoryControls=document.createElement('div');documentHistoryControls.className='document-history-controls';documentHistoryControls.setAttribute('role','group');documentHistoryControls.setAttribute('aria-label','실행 취소와 다시 실행');
for(const [id,redo,label,icon]of [['documentUndo',false,'실행 취소','#i-markup-undo'],['documentRedo',true,'다시 실행','#i-markup-undo']]){
 const button=document.createElement('button');button.type='button';button.id=id;button.className='btn icon';button.setAttribute('aria-label',label);button.innerHTML='<svg class="ic" aria-hidden="true"><use href="'+icon+'"/></svg>';button.onclick=()=>requestEditUndo(redo);button.onpointerdown=e=>e.preventDefault();documentHistoryControls.append(button);
}
function placeDocumentHistory(){if(isCompactPro())$('boardWrap').querySelector('.legend').append(documentHistoryControls);else $('btnAll').after(documentHistoryControls);}
placeDocumentHistory();matchMedia('(max-width:620px), (max-width:880px) and (max-height:540px)').addEventListener('change',placeDocumentHistory);syncHistoryControls();
const pageOrderButton=document.createElement('button');pageOrderButton.type='button';pageOrderButton.id='pageOrderButton';pageOrderButton.className='btn icon';pageOrderButton.hidden=true;pageOrderButton.title='선택 페이지 순서 변경 · Alt + 방향키';pageOrderButton.setAttribute('aria-label','선택 페이지 순서 변경');
pageOrderButton.innerHTML='<svg class="ic" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 20V4m-4 4 4-4 4 4M17 4v16m-4-4 4 4 4-4"/></svg>';
$('btnBlank').after(pageOrderButton);
const pageOrderDialog=document.createElement('dialog');pageOrderDialog.id='pageOrderDialog';pageOrderDialog.className='pdf-save-dialog page-order-dialog';pageOrderDialog.setAttribute('aria-labelledby','pageOrderTitle');
pageOrderDialog.innerHTML='<form method="dialog"><header class="pdf-save-head"><h2 id="pageOrderTitle">페이지 순서</h2><button class="btn quiet icon" value="close" aria-label="순서 창 닫기">×</button></header><div class="pdf-save-body"><p id="pageOrderSummary"></p><div class="page-order-steps"><button class="btn" type="button" id="pageOrderEarlier">앞으로</button><button class="btn" type="button" id="pageOrderLater">뒤로</button></div><label class="pro-field" for="pageOrderPosition"><span>이동 후 시작 위치</span><input id="pageOrderPosition" type="number" min="1" step="1"></label><p id="pageOrderError" class="pdf-save-error" role="alert"></p></div><footer class="pdf-save-actions"><button class="btn" value="close">닫기</button><button class="btn primary" id="pageOrderApply" type="button">이 위치로 이동</button></footer></form>';
document.body.append(pageOrderDialog);
let orderUids=[];
function syncPageNavigation(){if(typeof pageOrderButton==='undefined')return;pageOrderButton.hidden=!selected().length||pages.length<2;}
function orderState(uids){const set=new Set(uids),block=pages.filter(p=>set.has(p.uid));return {block,rest:pages.filter(p=>!set.has(p.uid)),first:pages.findIndex(p=>set.has(p.uid))};}
async function movePageBlock(uids,position){
 if(document.body.classList.contains('is-busy'))return;
 await textUpdate;const {block,rest}=orderState(uids);if(!block.length)return;
 const at=Math.max(0,Math.min(rest.length,position));commitMove(block.map(p=>p.uid),rest[at]?.uid||null);
 if(!pageOrderDialog.open){block[0].el.focus({preventScroll:true});block[0].el.scrollIntoView({block:'nearest',inline:'nearest'});}
}
function syncPageOrderDialog(){
 const {block,rest,first}=orderState(orderUids);$('pageOrderSummary').textContent=block.length+'페이지를 순서대로 함께 이동합니다.';
 $('pageOrderPosition').max=rest.length+1;$('pageOrderPosition').value=first+1;
 $('pageOrderEarlier').disabled=first<=0;$('pageOrderLater').disabled=first>=rest.length;
}
pageOrderButton.onclick=()=>{orderUids=selected().map(p=>p.uid);if(!orderUids.length)return;syncPageOrderDialog();$('pageOrderError').textContent='';pageOrderDialog.showModal();$('pageOrderPosition').focus();$('pageOrderPosition').select();};
for(const[id,direction]of [['pageOrderEarlier',-1],['pageOrderLater',1]])$(id).onclick=async()=>{await movePageBlock(orderUids,orderState(orderUids).first+direction);syncPageOrderDialog();};
$('pageOrderApply').onclick=async()=>{const input=$('pageOrderPosition'),n=Number(input.value);if(!input.value||!Number.isInteger(n)||n<1||n>Number(input.max)){$('pageOrderError').textContent='1~'+input.max+' 사이의 위치를 입력하세요.';input.focus();return;}await movePageBlock(orderUids,n-1);pageOrderDialog.close();};
$('pageOrderPosition').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('pageOrderApply').click();}});
pageOrderDialog.addEventListener('close',()=>{const p=pages.find(p=>p.uid===orderUids[0]);p?.el.focus({preventScroll:true});});
board.addEventListener('keydown',e=>{
 const card=e.target.closest('.page');if(!card||e.target!==card||e.isComposing||document.body.classList.contains('is-busy'))return;
 const index=pages.findIndex(p=>p.uid===card.dataset.uid);if(index<0)return;
 if(e.key===' '||e.key==='Enter'){e.preventDefault();e.stopPropagation();select(index,{ctrlKey:e.key===' '||e.ctrlKey||e.metaKey,shiftKey:e.shiftKey});return;}
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
 e.preventDefault();e.stopPropagation();
 const direction=['ArrowLeft','ArrowUp','Home'].includes(e.key)?-1:1;
 if(e.altKey){const picked=selected(),uids=(picked.includes(pages[index])?picked:[pages[index]]).map(p=>p.uid);void movePageBlock(uids,orderState(uids).first+direction);return;}
 let target=e.key==='Home'?0:e.key==='End'?pages.length-1:Math.max(0,Math.min(pages.length-1,index+direction));
 if(e.key==='ArrowUp'||e.key==='ArrowDown'){
  const from=card.getBoundingClientRect(),x=from.left+from.width/2,y=from.top+from.height/2;
  const next=pages.map((p,i)=>{const r=p.el.getBoundingClientRect(),dx=r.left+r.width/2-x,dy=r.top+r.height/2-y;return {i,dy,score:Math.abs(dx)*2+Math.abs(dy)};}).filter(p=>p.dy*direction>from.height*.25).sort((a,b)=>a.score-b.score)[0];
  target=next?.i??index;
 }
 if(e.shiftKey){if(lastClicked===null)lastClicked=index;select(target,{shiftKey:true});}
 pages[target].el.focus({preventScroll:true});pages[target].el.scrollIntoView({block:'nearest',inline:'nearest'});
});
syncPageNavigation();
