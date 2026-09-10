/* Print the edited PDF with the browser's PDF viewer, preserving vector output.
   Only one local PDF/frame is retained; no upload or temporary disk file. */
let printJob=null;
function supportsPdfPrinting(){return navigator.pdfViewerEnabled!==false;}
function releasePrintJob(){
  const job=printJob;if(!job)return;
  printJob=null;clearTimeout(job.timer);job.controller?.abort();
  if(job.frame){job.frame.onload=job.frame.onerror=null;job.frame.remove();}
  if(job.url)URL.revokeObjectURL(job.url);
  $('printOpenPdf').removeAttribute('href');$('printRetry').disabled=true;$('printDialog').close();
}
function closePrintDialog(){
  const job=printJob;clearTimeout(job?.timer);
  if(job?.frame)job.frame.onload=job.frame.onerror=null;
  $('printDialog').close();
  // Some browsers return from print() before their print sheet closes. Keep its
  // source alive until the next print request or navigation, even after close.
  if(job&&!job.invoked)releasePrintJob();
}
function printFallback(job,message){
  if(printJob!==job)return;
  clearTimeout(job.timer);job.phase='fallback';
  if(job.frame)job.frame.onload=job.frame.onerror=null;
  $('printStatus').textContent=message||'이 브라우저에서는 PDF를 열어 인쇄해 주세요.';
  $('printHelp').textContent='아래 PDF 열기를 누른 뒤, PDF 뷰어의 인쇄 메뉴를 이용하세요.';
  $('printRetry').disabled=true;
}
function invokeDocumentPrint(frame){frame.contentWindow.focus();frame.contentWindow.print();}
function printPreparedDocument(job=printJob){
  if(!job||job!==printJob||!job.ready||job.phase==='printing')return;
  clearTimeout(job.timer);job.phase='printing';job.invoked=true;
  $('printStatus').textContent='인쇄 창에서 프린터를 선택해 주세요.';
  $('printHelp').textContent='인쇄 창이 보이지 않으면 다시 열거나 PDF를 직접 열어 인쇄할 수 있습니다.';
  try{invokeDocumentPrint(job.frame);}
  catch(e){job.invoked=false;printFallback(job,'인쇄 창을 직접 열지 못했습니다. PDF를 열어 인쇄해 주세요.');}
  finally{if(printJob===job&&job.phase==='printing')job.phase='ready';}
}
function mountPrintDocument(job){
  $('printSummary').textContent=`전체 ${job.count}페이지 · ${job.mode==='pro'?'Pro 설정 반영':'현재 편집본'}`;
  $('printStatus').textContent='인쇄 창을 여는 중…';
  $('printHelp').textContent='프린터와 인쇄할 페이지 범위는 브라우저 인쇄 창에서 선택합니다.';
  $('printRetry').disabled=true;$('printOpenPdf').href=job.url;
  $('printDialog').showModal();
  if(!supportsPdfPrinting()){printFallback(job);return;}
  const frame=document.createElement('iframe');job.frame=frame;job.phase='loading';
  frame.className='pdf-print-frame';frame.title='인쇄할 편집 PDF';frame.tabIndex=-1;frame.setAttribute('aria-hidden','true');
  frame.onload=()=>{
    if(printJob!==job||job.phase!=='loading')return;
    clearTimeout(job.timer);job.ready=true;job.phase='ready';$('printRetry').disabled=false;
    // PDF viewer initialization follows the outer frame's load event.
    job.timer=setTimeout(()=>{if($('printDialog').open)printPreparedDocument(job);},1000);
    try{frame.contentWindow.addEventListener('afterprint',()=>{if(printJob===job&&job.invoked)closePrintDialog();},{once:true});}catch(_){}
  };
  frame.onerror=()=>printFallback(job,'인쇄용 PDF를 열지 못했습니다. PDF 열기로 다시 시도해 주세요.');
  job.timer=setTimeout(()=>printFallback(job,'인쇄 창을 준비하는 데 시간이 걸립니다. PDF를 직접 열어 인쇄할 수 있습니다.'),20000);
  frame.src=job.url;document.body.appendChild(frame);
}
async function printCurrentDocument(){
  if(!pages.length||printJob?.phase==='preparing'||document.body.classList.contains('is-busy')||document.querySelector('dialog[open]'))return;
  releasePrintJob();
  const job={mode:proMode,phase:'preparing',controller:null,url:null,frame:null,ready:false,invoked:false};printJob=job;
  const active=()=>printJob===job&&!job.controller?.signal.aborted;
  try{
    do{await textUpdate;}while(active()&&textEditPending);
    if(!active()||!finishTextEdit(true))return;
    let bytes;
    if(job.mode==='pro'){
      let result=proResult?.fingerprint===proFingerprint()?proResult:null;
      if(!result){const pending=createProResult({reveal:false});job.controller=proAbort;result=await pending;}
      if(!active()||!result)return;
      bytes=result.bytes;
    }else{
      startProWork('인쇄할 편집본을 준비하는 중…');job.controller=proAbort;
      try{
        const doc=await buildEditedDocument(pages,{signal:job.controller.signal,onProgress:(done,total)=>{busy(true,`인쇄 준비 중… ${done}/${total}페이지`);progress(done/total*100);}});
        job.controller.signal.throwIfAborted();
        bytes=await doc.save({useObjectStreams:true,updateFieldAppearances:false});
      }finally{finishProWork();}
    }
    if(!active())return;
    job.count=pages.length;job.url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    mountPrintDocument(job);
  }catch(e){
    if(active()&&e.name!=='AbortError'){console.error(e);toast('인쇄할 PDF를 준비하지 못했습니다. 다시 시도해 주세요.',true);}
  }finally{
    if(printJob===job&&job.phase==='preparing')releasePrintJob();
  }
}
$('btnPrint').onclick=$('mbPrint').onclick=printCurrentDocument;
$('printRetry').onclick=()=>printPreparedDocument();
$('printClose').onclick=$('printBack').onclick=closePrintDialog;
$('printDialog').addEventListener('cancel',e=>{e.preventDefault();closePrintDialog();});
window.addEventListener('pagehide',releasePrintJob);
document.addEventListener('keydown',e=>{
  if(!(e.ctrlKey||e.metaKey)||e.altKey||e.key.toLowerCase()!=='p')return;
  const dialog=document.querySelector('dialog[open]');
  if(dialog&&dialog!==$('printDialog'))return;
  if(!pages.length)return;
  e.preventDefault();e.stopImmediatePropagation();
  if(dialog)printPreparedDocument();else void printCurrentDocument();
},true);
