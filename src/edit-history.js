/* Undo stores document metadata; PDF bytes, thumbnails and image assets are shared. */
class EditHistoryStack{
  constructor(limit=50,budget=8*1024*1024,sourceBudget=128*1024*1024){this.undo=[];this.redo=[];this.limit=limit;this.budget=budget;this.sourceBudget=sourceBudget;}
  push(before,after,label,key=null,windowMs=700){
    if(!before||before.signature===after.signature)return false;
    const now=Date.now(),last=this.undo.at(-1);
    if(key&&last?.key===key&&now-last.time<=windowMs&&last.after.signature===before.signature){last.after=after;last.time=now;if(last.before.signature===after.signature)this.undo.pop();}
    else this.undo.push({before,after,label,key,time:now});
    this.redo=[];
    const cost=()=>this.undo.reduce((n,e)=>n+(e.before.signature.length+e.after.signature.length)*2+(e.before.extraBytes||0)+(e.after.extraBytes||0),0);
    const active=new Set((after.sources||[]).map(([,d])=>d));
    const sourceCost=()=>{const retained=new Set();let bytes=0;for(const entry of this.undo)for(const state of [entry.before,entry.after])for(const [,d]of state.sources||[])if(!active.has(d)&&!retained.has(d)){retained.add(d);bytes+=d.libBytes?.byteLength||0;}return bytes;};
    // Source PDFs are shared, but an old import/Pro conversion can otherwise
    // retain gigabytes despite a small metadata history. Keep the newest undo
    // transaction even when that single document exceeds the source budget.
    while(this.undo.length>1&&(this.undo.length>this.limit||cost()>this.budget||sourceCost()>this.sourceBudget))this.undo.shift();
    return true;
  }
  take(redo=false){const from=redo?this.redo:this.undo,to=redo?this.undo:this.redo,entry=from.pop();if(!entry)return null;entry.key=null;to.push(entry);return {state:redo?entry.after:entry.before,label:entry.label};}
  clear(){this.undo=[];this.redo=[];}
}
const editHistory=new EditHistoryStack(),historyAnnotationCache=new WeakMap(),historyDocuments=new Set();
let historyApplying=false,historyQueue=Promise.resolve(),historyDraft=null,historyTextFormat=null;
const textHistoryFields=['text','font','fontSize','lineGap','color','bold','boldRanges','italic','strike','nx','ny'];
function captureEditHistory(){
  if(historyApplying)return null;
  const rows=pages.map(page=>{
    const signature=JSON.stringify(page.annots||[]);let annotations=historyAnnotationCache.get(page);
    if(annotations?.signature!==signature){annotations={signature,value:structuredClone(page.annots||[])};historyAnnotationCache.set(page,annotations);}
    return {page,rotation:page.rotation,deskewAngle:page.deskewAngle,deskewCrop:typeof page.deskewCrop==='boolean'?page.deskewCrop:undefined,annots:annotations.value,signature};
  });
  const used=new Set(pages.map(p=>p.docId)),sources=[...docs].filter(([id])=>used.has(id));for(const [,d]of sources)historyDocuments.add(d);
  const stamps=typeof captureStampHistory==='function'?captureStampHistory():null;
  return {rows,sources,origCount,selected:selected().map(p=>p.uid),previewUid,selAnno,stamps,
    signature:JSON.stringify([rows.map(r=>[r.page.uid,r.rotation,r.signature,r.deskewAngle,r.deskewCrop]),sources.map(([id])=>id),origCount,stamps?.signature])};
}
function collectHistoryDocuments(){
  const used=new Set(pages.map(p=>p.docId));
  // Removed pages remain undoable through their snapshots. They must not keep
  // their source in every subsequent snapshot or in the current document map.
  for(const [id,d]of docs)if(!used.has(id)){historyDocuments.add(d);docs.delete(id);}
  const retained=new Set(docs.values()),retainedPages=new Set(pages.map(p=>p.uid));
  for(const entry of [...editHistory.undo,...editHistory.redo])for(const state of [entry.before,entry.after]){
    for(const [,d]of state.sources)retained.add(d);
    for(const row of state.rows||[])retainedPages.add(row.page.uid);
  }
  for(const d of historyDocuments)if(!retained.has(d)){historyDocuments.delete(d);void Promise.resolve().then(()=>d.pdfjsDoc?.destroy()).catch(()=>{});}
  // Deleted-page recognition stays available to undo, but must not outlive the
  // last current/undo/redo reference to that page. Keep the array identity when
  // nothing expires so an open OCR correction draft is not invalidated.
  if(typeof ocrRecords!=='undefined'&&ocrRecords.some(record=>!retainedPages.has(record.uid))){
    const chooser=typeof $==='function'?$('ocrResultPage'):null,shown=chooser?ocrRecords[Number(chooser.value)]?.uid:null;
    ocrRecords=ocrRecords.filter(record=>retainedPages.has(record.uid));
    if(typeof renderOCRResults==='function'){
      renderOCRResults();const index=shown?ocrRecords.findIndex(record=>record.uid===shown):-1;
      if(chooser&&index>=0){chooser.value=String(index);if(typeof renderOCRText==='function')renderOCRText();}
    }
  }
}
function commitEditHistory(before,label,key=null){
  if(!before||historyApplying)return;
  editHistory.push(before,captureEditHistory(),label,key);collectHistoryDocuments();syncHistoryControls();
}
function clearEditHistory(){editHistory.clear();historyDraft=null;historyTextFormat=null;collectHistoryDocuments();historyDocuments.clear();syncHistoryControls();}
function deferHistoryEdit(action){if(textEditPending){void textUpdate.then(action);return true;}flushTextHistory();return false;}
function textHistoryState(a,change={}){
  const values={};for(const key of textHistoryFields)values[key]=key in change?change[key]:a[key];
  for(const key of ['bold','italic','strike'])values[key]=!!values[key];
  values.boldRanges=structuredClone(values.boldRanges||[]);
  values.text=String(values.text||'');
  const input=$('textInput');return {values,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,signature:JSON.stringify(values)};
}
function startTextHistory(session,before){
  historyTextFormat=null;session.historyBefore=before;
  historyDraft={session,stack:new EditHistoryStack(100),current:textHistoryState(session.a),compositionBefore:null};syncHistoryControls();
}
function finishTextHistory(session,apply){
  if(historyDraft?.session===session)historyDraft=null;
  if(apply)commitEditHistory(session.historyBefore,session.snapshot?'텍스트 수정':'텍스트 추가');
  syncHistoryControls();
}
function recordTextHistory(change,options={}){
  if(options.history===false||historyApplying)return;
  if(historyDraft?.session===textEditing){
    const draft=historyDraft,before=draft.current,after=textHistoryState(before.values,change);
    const keys=Object.keys(change),typing=keys.includes('text')&&keys.every(key=>['text','bold','boldRanges'].includes(key));
    if(!typing){const input=$('textInput');before.start=input.selectionStart;before.end=input.selectionEnd;before.direction=input.selectionDirection;}
    let key=typing?'typing:'+(options.inputType||'input'):keys.length===1&&['fontSize','lineGap'].includes(keys[0])?'format:'+keys[0]:null;
    if(typing&&/paste|drop|linebreak|paragraph/i.test(options.inputType||''))key=null;
    if(draft.compositionBefore){
      draft.current=after;
      if(textComposing)return;
      draft.stack.push(draft.compositionBefore,after,'텍스트 입력');draft.compositionBefore=null;
    }else{draft.stack.push(before,after,typing?'텍스트 입력':'텍스트 서식',key);draft.current=after;}
    syncHistoryControls();return;
  }
  const a=textSelection();if(a&&!historyTextFormat){const keys=Object.keys(change);historyTextFormat={before:captureEditHistory(),key:keys.length===1&&['fontSize','lineGap'].includes(keys[0])?a.id+':'+keys[0]:null};}
}
function flushTextHistory(){
  if(!historyTextFormat||textEditPending)return;
  const {before,key}=historyTextFormat;historyTextFormat=null;commitEditHistory(before,'텍스트 서식',key);
}
function syncHistoryControls(){
  const stack=historyDraft?.session===textEditing?historyDraft.stack:editHistory;
  for(const [id,entries]of [['editUndo',stack.undo],['editRedo',stack.redo],['documentUndo',stack.undo],['documentRedo',stack.redo]]){
    const button=$(id);if(!button)continue;button.disabled=!entries.length||!!textComposing;
    button.title=(id.endsWith('Undo')?'되돌리기':'다시 실행')+(entries.length?' · '+entries.at(-1).label:'');
  }
}
async function restoreTextHistory(redo,session){
  const draft=historyDraft;if(!draft||draft.session!==session||session!==textEditing||textComposing)return false;
  const entry=draft.stack.take(redo);if(!entry)return false;
  const state=entry.state;draft.current=structuredClone(state);
  // Invalidate any old layout before publishing the restored input. New typing
  // can still supersede this request through the normal revision check.
  textChangeRevision++;pendingTextChanges.delete(session.a);textEditPending=false;textUpdate=Promise.resolve();
  Object.assign(session.a,{nx:state.values.nx,ny:state.values.ny,bold:state.values.bold,italic:state.values.italic,strike:state.values.strike,color:state.values.color});
  $('textInput').value=state.values.text;
  const update=queueTextChange(state.values,{history:false}),revision=textChangeRevision;
  syncHistoryControls();await update;
  if(textEditing===session&&textChangeRevision===revision){$('textInput').setSelectionRange(state.start,state.end,state.direction);syncHistoryControls();}
  return true;
}
async function restoreDocumentHistory(redo){
  await textUpdate;flushTextHistory();
  if(textEditing||textOpening)return false;
  const entry=editHistory.take(redo);if(!entry)return false;
  const state=entry.state,positions=captureBoardPositions(),tool=annoStyle.tool;
  const view={zoom:pvZoom,top:$('pvBody').scrollTop,left:$('pvBody').scrollLeft};
  historyApplying=true;busy(true,redo?'편집을 다시 적용하는 중…':'편집을 되돌리는 중…');
  try{
    clearPreview();pvZoom=view.zoom;docs.clear();for(const [id,d]of state.sources)docs.set(id,d);
    pages=state.rows.map(r=>{r.page.rotation=r.rotation;if(Number.isFinite(r.deskewAngle))r.page.deskewAngle=r.deskewAngle;else delete r.page.deskewAngle;if(typeof r.deskewCrop==='boolean')r.page.deskewCrop=r.deskewCrop;else delete r.page.deskewCrop;r.page.annots=structuredClone(r.annots);return r.page;});origCount=state.origCount;
    if(state.stamps&&typeof restoreStampHistory==='function')restoreStampHistory(state.stamps);
    if(state.proTransfer)restoreProTransferSettings(state.proTransfer);
    if(state.pageOcr){const ids=new Set(state.pageOcr.map(r=>r.uid)),active=new Set(pages.map(p=>p.uid));ocrRecords=ocrRecords.filter(r=>!ids.has(r.uid)).concat(state.pageOcr.filter(r=>r.record&&active.has(r.uid)).map(r=>r.record));}
    lastClicked=null;render();const picked=new Set(state.selected);for(const p of pages)p.el.classList.toggle('selected',picked.has(p.uid));
    const shown=pages.find(p=>p.uid===state.previewUid)||pages[0];if(shown)await showPreview(shown);
    $('pvBody').scrollTop=view.top;$('pvBody').scrollLeft=view.left;
    selAnno=tool==='none'&&shown?.annots.some(a=>a.id===state.selAnno)?state.selAnno:null;
    renderAnnots();renderInfo();syncCounts();animateBoardFrom(positions);
    toast((redo?'다시 실행: ':'되돌리기: ')+entry.label);return true;
  }finally{historyApplying=false;busy(false);collectHistoryDocuments();syncHistoryControls();}
}
function requestEditUndo(redo=false){
  if(textComposing||textOpening||document.querySelector('dialog[open]')||$('modal').classList.contains('open')||(document.body.classList.contains('is-busy')&&!historyApplying))return Promise.resolve(false);
  if(drag){cancelAnnotationDrag();return Promise.resolve(true);}
  if(typeof cancelDeskewGesture==='function'&&cancelDeskewGesture())return Promise.resolve(true);
  if(typeof cancelReviewStampGesture==='function'&&cancelReviewStampGesture())return Promise.resolve(true);
  if(blankPointer){endBlankDrag(false);return Promise.resolve(true);}
  if(tdrag?.active){endTouchDrag(false);return Promise.resolve(true);}
  if(dragUids.length){dragUids=[];removeBoardMarker();board.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));return Promise.resolve(true);}
  const session=textEditing;
  historyQueue=historyQueue.then(()=>session?restoreTextHistory(redo,session):restoreDocumentHistory(redo)).catch(e=>{console.error(e);toast('편집을 되돌리지 못했습니다.',true);return false;});
  return historyQueue;
}
$('editUndo').onclick=()=>requestEditUndo();$('editRedo').onclick=()=>requestEditUndo(true);
for(const id of ['editUndo','editRedo'])$(id).onpointerdown=e=>e.preventDefault();
$('textInput').addEventListener('beforeinput',()=>{
  if(!historyDraft||historyDraft.session!==textEditing||textComposing)return;
  const input=$('textInput'),current=historyDraft.current;
  if(current.start!==input.selectionStart||current.end!==input.selectionEnd){const last=historyDraft.stack.undo.at(-1);if(last)last.key=null;}
  current.start=input.selectionStart;current.end=input.selectionEnd;current.direction=input.selectionDirection;
});
$('textInput').addEventListener('compositionstart',()=>{if(historyDraft)historyDraft.compositionBefore=structuredClone(historyDraft.current);},true);
document.addEventListener('keydown',e=>{
  if(!(e.ctrlKey||e.metaKey)||e.altKey||e.isComposing||textComposing)return;
  const key=e.key.toLowerCase(),redo=key==='y'||key==='z'&&e.shiftKey;if(key!=='z'&&key!=='y')return;
  if(document.querySelector('dialog[open]')||$('modal').classList.contains('open'))return;
  const field=e.target.closest('input,textarea,select,[contenteditable="true"]');
  if(field&&field!==$('textInput')&&!(textEditing&&$('annoTextProperties').contains(field)))return;
  e.preventDefault();e.stopImmediatePropagation();void requestEditUndo(redo);
},true);
syncHistoryControls();
