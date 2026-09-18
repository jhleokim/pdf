/* Prepare once; the user's download click stays synchronous on mobile browsers. */
let basicSaveState=null,documentFilename=null,savePreparation=Promise.resolve();
function pdfFilename(value){
  let name=String(value).trim().replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,100);
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;
  return name;
}
function suggestedPdfFilename(){
  return pdfFilename(PDFSource.filename(pages,docs));
}
function syncDocumentFilename(){if(typeof documentFilename==='undefined')return;$('proFilename').value=documentFilename??suggestedPdfFilename();}
function resetDocumentFilename(){documentFilename=null;syncDocumentFilename();}
function syncBasicSaveAction(){
  const state=basicSaveState;if(!state)return;
  const valid=!!pdfFilename($('basicSaveFilename').value);
  $('basicFilenameError').textContent=valid?'':'파일 이름을 입력해 주세요.';
  $('basicSaveFilename').setAttribute('aria-invalid',String(!valid));
  $('basicSaveDownload').disabled=state.phase==='preparing'||!valid||!state.pages.length;
  $('basicSaveDownloadLabel').textContent=state.phase==='preparing'?'준비 중…':state.phase==='error'||state.phase==='idle'?'다시 준비':state.phase==='downloaded'?'다시 다운로드':'PDF 다운로드';
  $('basicSaveResult').dataset.phase=state.phase;
  $('basicSaveStateIcon').setAttribute('href',state.phase==='error'?'#i-alert':state.phase==='preparing'?'#i-file':'#i-check');
}
async function prepareBasicSave(state){
  state.phase='preparing';state.bytes=null;$('basicSaveError').textContent='';
  $('basicSaveStatus').textContent='PDF 준비 중…';$('basicSaveDetail').textContent=state.pages.length+'페이지의 편집 내용을 포함합니다.';syncBasicSaveAction();
  const active=()=>basicSaveState===state&&!state.controller.signal.aborted;
  try{
    if(!state.pages.length)throw new Error('편집 화면에서 저장할 페이지를 선택해 주세요.');
    if(state.mode==='pro')state.options=readProOptions(true,state.pages);
    if(!await confirmDocumentExport(state.pages)){
      if(active()){state.phase='idle';$('basicSaveStatus').textContent='저장 준비를 취소했습니다';$('basicSaveDetail').textContent='저장 범위를 바꾸거나 다시 준비할 수 있습니다.';}
      return;
    }
    if(!active())return;
    let bytes;
    if(state.mode==='pro'){
      const cached=state.scope==='all'&&proResult?.fingerprint===state.fingerprint?proResult:null;
      const result=cached||await buildProExport(state.pages,state.options,{signal:state.controller.signal,pageIndices:state.pageIndices,onProgress:(n,label)=>{if(active())$('basicSaveDetail').textContent=label+' · '+Math.round(n)+'%';}});
      bytes=result.bytes;
      if(active()&&!cached&&state.scope==='all')publishProExport(result,state.options,state.fingerprint);
    }else{
    let out=await buildEditedDocument(state.pages,{signal:state.controller.signal,onProgress:(done,total)=>{if(active())$('basicSaveDetail').textContent=done+' / '+total+'페이지 반영';}});
    if(!active())return;
    $('basicSaveStatus').textContent='글꼴과 편집 내용을 저장하는 중…';await idle();
    out=await finalizePrivateExport(out,state.pages,{signal:state.controller.signal,onProgress:(n,total)=>{if(active())$('basicSaveDetail').textContent='개인정보 영구 삭제 '+n+' / '+total+'페이지';}});
    bytes=await out.save({useObjectStreams:true,updateFieldAppearances:false});
    }
    if(!active())return;
    state.bytes=bytes;state.phase='ready';
    $('basicSaveStatus').textContent='다운로드할 준비가 됐습니다';$('basicSaveDetail').textContent=state.pages.length+'페이지 · '+formatBytes(bytes.length);
  }catch(e){
    if(!active()||e.name==='AbortError')return;
    state.phase='error';$('basicSaveStatus').textContent='PDF를 준비하지 못했습니다';
    $('basicSaveDetail').textContent='편집 내용은 그대로 유지됩니다.';
    $('basicSaveError').textContent=/[가-힣]/.test(e.message||'')?e.message:'다시 준비하거나 편집 화면으로 돌아가 주세요.';
    console.error(e);
  }finally{if(active())syncBasicSaveAction();}
}
async function openBasicSaveDialog({scope='all'}={}){
  const dialog=$('basicSaveDialog');if(dialog.open)return basicSaveState?.pending;
  if(!pages.length||document.body.classList.contains('is-busy'))return;
  if(typeof textUpdate!=='undefined'){
    // Typing or changing fonts can replace the layout promise while Save waits.
    do{await textUpdate;}while(typeof textEditPending!=='undefined'&&textEditPending);
  }
  // Another save or export may have started while the text layout was pending.
  if(dialog.open)return basicSaveState?.pending;
  if(!pages.length||document.body.classList.contains('is-busy'))return;
  if(typeof finishTextEdit==='function'&&!finishTextEdit(true))return;
  const mode=proMode,chosen=new Set(selected().map(p=>p.uid));
  let options;try{if(mode==='pro')options=readProOptions();}catch(e){toast(e.message,true);return;}
  const list=pages.map(p=>({...p,annots:structuredClone(p.annots||[])}));
  basicSaveState={allPages:list,chosen,mode,options,fingerprint:proFingerprint(),controller:new AbortController()};
  $('basicSaveFilename').value=documentFilename??suggestedPdfFilename();
  $('basicSaveAllCount').textContent=list.length+'쪽';$('basicSaveSelectedCount').textContent=chosen.size+'쪽';
  $('basicSaveSelected').disabled=!chosen.size;
  if(mode==='pro')cancelLivePreview();
  dialog.showModal();$('basicSaveFilename').focus();$('basicSaveFilename').select();
  return changeBasicSaveScope(scope);
}
function savePageRange(indices){
  const ranges=[];let start,end;
  for(const index of indices){const n=index+1;if(start===undefined)start=end=n;else if(n===end+1)end=n;else{ranges.push(start===end?String(start):start+'–'+end);start=end=n;}}
  if(start!==undefined)ranges.push(start===end?String(start):start+'–'+end);
  return ranges.join(', ');
}
function changeBasicSaveScope(scope){
  const previous=basicSaveState;if(!previous)return;
  previous.controller.abort();
  const {allPages,chosen,mode,options,fingerprint}=previous;
  const pageIndices=allPages.flatMap((p,i)=>scope==='all'||chosen.has(p.uid)?[i]:[]);
  const state={allPages,chosen,mode,options,fingerprint,scope,pageIndices,pages:pageIndices.map(i=>allPages[i]),controller:new AbortController(),phase:'preparing',bytes:null,pending:null};basicSaveState=state;
  $('basicSaveAll').checked=scope==='all';$('basicSaveSelected').checked=scope==='selected';
  $('basicSaveSummary').textContent=(scope==='all'?'전체 ':'선택한 ')+state.pages.length+'페이지 저장';
  $('basicSavePages').textContent=pageIndices.length?savePageRange(pageIndices)+'쪽 · 현재 문서 순서대로 저장':'편집 화면에서 페이지를 먼저 선택해 주세요.';
  $('basicSaveError').textContent='';$('basicSaveStatus').textContent='PDF 준비 중…';$('basicSaveDetail').textContent=state.pages.length+'페이지';syncBasicSaveAction();
  // Finish cancellation before reusing PDF workers and font/redaction caches.
  const prior=savePreparation;
  state.pending=savePreparation=(async()=>{await prior.catch(()=>{});if(basicSaveState===state&&!state.controller.signal.aborted)await prepareBasicSave(state);})();
  return state.pending;
}
for(const id of ['basicSaveAll','basicSaveSelected'])$(id).addEventListener('change',e=>{if(e.target.checked)void changeBasicSaveScope(e.target.value);});
function closeBasicSaveDialog(){
  basicSaveState?.controller.abort();basicSaveState=null;$('basicSaveDialog').close();
  if(proMode==='pro')scheduleLivePreview();
}
function downloadBasicSave(){
  const state=basicSaveState;if(!state)return;
  const name=pdfFilename($('basicSaveFilename').value);syncBasicSaveAction();if(!name||state.phase==='preparing')return;
  if(state.phase==='error'||state.phase==='idle'){state.pending=savePreparation=prepareBasicSave(state);return state.pending;}
  if(!state.bytes)return;
  try{
    downloadPdf(state.bytes,name+'.pdf');state.phase='downloaded';$('basicSaveFilename').value=name;
    $('basicSaveStatus').textContent='다운로드를 시작했습니다';$('basicSaveDetail').textContent=name+'.pdf · '+formatBytes(state.bytes.length);
    syncBasicSaveAction();
  }catch(e){$('basicSaveError').textContent='다운로드를 시작하지 못했습니다. 다시 눌러 주세요.';}
}
$('basicSaveDownload').onclick=downloadBasicSave;
$('basicSaveFilename').oninput=()=>{documentFilename=$('basicSaveFilename').value;syncDocumentFilename();syncBasicSaveAction();};
$('proFilename').addEventListener('input',()=>{documentFilename=$('proFilename').value;});
$('basicSaveBack').onclick=$('basicSaveClose').onclick=closeBasicSaveDialog;
$('basicSaveDialog').addEventListener('cancel',e=>{e.preventDefault();closeBasicSaveDialog();});
$('basicSaveDialog').addEventListener('close',()=>{if(!$('basicSaveDialog').open){basicSaveState?.controller.abort();basicSaveState=null;}});
$('basicSaveDialog').addEventListener('keydown',e=>{
  if(e.isComposing)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void downloadBasicSave();}
  if(e.key==='Enter'&&e.target===$('basicSaveFilename')){e.preventDefault();void downloadBasicSave();}
});
syncDocumentFilename();
