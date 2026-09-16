/* Prepare once; the user's download click stays synchronous on mobile browsers. */
let basicSaveState=null,documentFilename=null;
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
  $('basicSaveDownload').disabled=state.phase==='preparing'||!valid;
  $('basicSaveDownloadLabel').textContent=state.phase==='preparing'?'준비 중…':state.phase==='error'?'다시 준비':state.phase==='downloaded'?'다시 다운로드':'PDF 다운로드';
  $('basicSaveResult').dataset.phase=state.phase;
  $('basicSaveStateIcon').setAttribute('href',state.phase==='error'?'#i-alert':state.phase==='preparing'?'#i-file':'#i-check');
}
async function prepareBasicSave(state){
  state.phase='preparing';state.bytes=null;$('basicSaveError').textContent='';
  $('basicSaveStatus').textContent='PDF 준비 중…';$('basicSaveDetail').textContent='모든 페이지와 편집 내용을 포함합니다.';syncBasicSaveAction();
  const active=()=>basicSaveState===state&&!state.controller.signal.aborted;
  try{
    let out=await buildEditedDocument(state.pages,{signal:state.controller.signal,onProgress:(done,total)=>{if(active())$('basicSaveDetail').textContent=done+' / '+total+'페이지 반영';}});
    if(!active())return;
    $('basicSaveStatus').textContent='글꼴과 편집 내용을 저장하는 중…';await idle();
    out=await finalizePrivateExport(out,state.pages,{signal:state.controller.signal,onProgress:(n,total)=>{if(active())$('basicSaveDetail').textContent='개인정보 영구 삭제 '+n+' / '+total+'페이지';}});
    const bytes=await out.save({useObjectStreams:true,updateFieldAppearances:false});
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
async function openBasicSaveDialog(){
  const dialog=$('basicSaveDialog');if(dialog.open)return basicSaveState?.pending;
  if(!await confirmDocumentExport())return;
  const list=pages.map(p=>({...p,annots:structuredClone(p.annots||[])}));
  const textCount=list.reduce((n,p)=>n+p.annots.filter(a=>a.shape==='text').length,0);
  const state={pages:list,controller:new AbortController(),phase:'preparing',bytes:null,pending:null};basicSaveState=state;
  $('basicSaveFilename').value=documentFilename??suggestedPdfFilename();
  $('basicSaveSummary').textContent='전체 '+list.length+'페이지'+(textCount?' · 추가한 텍스트 '+textCount+'개':'');
  dialog.showModal();$('basicSaveFilename').focus();$('basicSaveFilename').select();
  state.pending=prepareBasicSave(state);return state.pending;
}
function closeBasicSaveDialog(){
  basicSaveState?.controller.abort();basicSaveState=null;$('basicSaveDialog').close();
}
function downloadBasicSave(){
  const state=basicSaveState;if(!state)return;
  const name=pdfFilename($('basicSaveFilename').value);syncBasicSaveAction();if(!name||state.phase==='preparing')return;
  if(state.phase==='error'){state.pending=prepareBasicSave(state);return state.pending;}
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
