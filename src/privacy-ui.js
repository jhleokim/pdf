'use strict';
let privacyPage=null,privacyGesture=null,privacySelection=null,privacyRenderToken=0,privacyRenderTask=null,privacyPageReady=false;
const documentChecks=new WeakMap();
let documentConfirmationPending=false;
async function documentPreflight(list=pages){
  const reports=[];
  for(const id of new Set(list.map(p=>p.docId))){
    const source=docs.get(id);if(!source)continue;
    let result=documentChecks.get(source);
    if(!result){result=PDFDocumentIntegrity.inspect(await PDFLib.PDFDocument.load(source.libBytes));documentChecks.set(source,result);}
    reports.push(result);
  }
  const combined=reports.reduce((a,r)=>{for(const k of ['signatures','forms','bookmarks','attachments','actions'])a[k]=(a[k]||0)+r[k];return a;},{});
  const same=list.length&&list.every(p=>p.docId===list[0].docId),source=same&&docs.get(list[0].docId);
  return PDFDocumentIntegrity.warnings(combined,{redacted:PDFPrivacy.isMasked(list),restructured:!same||list.length!==source.count||new Set(list.map(p=>p.srcIndex)).size!==source.count});
}
async function confirmDocumentExport(list=pages){
  if(documentConfirmationPending)return false;
  documentConfirmationPending=true;
  try{
  const warnings=await documentPreflight(list);if(!warnings.length)return true;
  const dialog=$('documentCheckDialog'),host=$('documentCheckWarnings');host.replaceChildren();
  for(const warning of warnings){const p=document.createElement('p');p.textContent=warning;host.append(p);}
  $('documentCheckAccept').checked=false;$('documentCheckContinue').disabled=true;
  return await new Promise(resolve=>{
    let accepted=false;const close=()=>{dialog.removeEventListener('close',close);resolve(accepted);};
    dialog.addEventListener('close',close);$('documentCheckContinue').onclick=()=>{if($('documentCheckAccept').checked){accepted=true;dialog.close();}};
    $('documentCheckCancel').onclick=()=>dialog.close();dialog.showModal();
  });
  }catch(e){console.error(e);toast('문서 구조를 확인하지 못했습니다. 다시 시도해 주세요.',true);return false;}
  finally{documentConfirmationPending=false;}
}
$('documentCheckAccept').onchange=()=>{$('documentCheckContinue').disabled=!$('documentCheckAccept').checked;};
async function finalizePrivateExport(doc,list,callbacks={}){return PDFPrivacy.isMasked(list)?PDFPrivacy.flatten(doc,{...callbacks,pageSources:list,docOptions:DOC_OPTS}):doc;}
function syncPrivacy(){
  const count=pages.reduce((n,p)=>n+(p.annots||[]).filter(a=>a.shape==='redaction').length,0);
  if(!count)PDFPrivacy.clearCache();
  $('privacyOpen').disabled=!pages.length||!!proAbort;$('privacySummary').textContent=count?count+'개 영역':'사용 안 함';
  $('privacySection').classList.toggle('has-settings',!!count);$('privacyStatus').textContent=count?'저장 시 마스킹 영역을 영구 삭제합니다.':'';
}
function renderPrivacyOverlay(){
  const svg=$('privacyOverlay');svg.replaceChildren();if(!privacyPage)return;
  for(const a of privacyPage.annots||[]){if(a.shape!=='redaction')continue;
    const rect=document.createElementNS(SVGNS,'rect');rect.setAttribute('x',a.nx*1000);rect.setAttribute('y',a.ny*1000);rect.setAttribute('width',a.nw*1000);rect.setAttribute('height',a.nh*1000);rect.setAttribute('fill','#111');rect.dataset.maskId=a.id;
    if(a.id===privacySelection){rect.setAttribute('stroke','#009b8a');rect.setAttribute('stroke-width','3');}svg.append(rect);
    if(a.id===privacySelection){const bounds=svg.getBoundingClientRect();for(const [x,y,pos]of [[a.nx,a.ny,'nw'],[a.nx+a.nw,a.ny,'ne'],[a.nx+a.nw,a.ny+a.nh,'se'],[a.nx,a.ny+a.nh,'sw']])for(const size of [44,10]){const w=size*1000/Math.max(1,bounds.width),h=size*1000/Math.max(1,bounds.height),handle=document.createElementNS(SVGNS,'rect');handle.setAttribute('x',x*1000-w/2);handle.setAttribute('y',y*1000-h/2);handle.setAttribute('width',w);handle.setAttribute('height',h);handle.setAttribute('fill',size===44?'transparent':'#fff');if(size===10)handle.setAttribute('stroke','#008779');handle.dataset.maskHandle=pos;svg.append(handle);}}
  }
  $('privacyDelete').disabled=!privacySelection;$('privacyEditStatus').textContent=(privacyPage.annots||[]).filter(a=>a.shape==='redaction').length+'개 영역 · 원본 파일은 유지됩니다';syncPrivacy();
}
async function showPrivacyPage(p){
  finishPrivacyGesture(true);
  const token=++privacyRenderToken;privacyRenderTask?.cancel();privacyPage=p;privacySelection=null;privacyPageReady=false;
  // A failed navigation must never leave another page's image available for
  // drawing masks against the newly selected page.
  $('privacyCanvas').width=$('privacyCanvas').height=0;$('privacyOverlay').replaceChildren();$('privacyDelete').disabled=true;
  const index=pages.indexOf(p);$('privacyPageLabel').textContent=(index+1)+' / '+pages.length+'페이지';$('privacyPrev').disabled=index<=0;$('privacyNext').disabled=index>=pages.length-1;
  $('privacyEditStatus').textContent='페이지 준비 중…';$('privacyOverlay').style.pointerEvents='none';let task;
  try{
    await PDFPrivacy.assertSupportedSources([p],docs);if(token!==privacyRenderToken)return;
    const doc=await buildEditedDocument([{...p,annots:(p.annots||[]).filter(a=>a.shape!=='redaction')}]);if(token!==privacyRenderToken)return;
    task=pdfjsLib.getDocument({data:await doc.save(),...DOC_OPTS});const pdf=await task.promise,page=await pdf.getPage(1),base=page.getViewport({scale:1});
    const vp=page.getViewport({scale:Math.min(2,1600/Math.max(base.width,base.height))});if(token!==privacyRenderToken)return;
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);canvas.id='privacyCanvas';
    privacyRenderTask=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:vp,background:'white'});await privacyRenderTask.promise;if(token!==privacyRenderToken)return;
    const old=$('privacyCanvas');old.replaceWith(canvas);old.width=old.height=0;$('privacyPaper').style.aspectRatio=base.width+'/'+base.height;
    $('privacyOverlay').setAttribute('viewBox','0 0 1000 1000');$('privacyOverlay').setAttribute('preserveAspectRatio','none');privacyPageReady=true;renderPrivacyOverlay();
  }catch(e){if(token===privacyRenderToken&&e.name!=='RenderingCancelledException')$('privacyEditStatus').textContent=e.code==='PRIVACY_OPTIONAL_CONTENT'?e.message:'페이지를 열지 못했습니다. 다시 시도해 주세요.';}
  finally{if(task)await task.destroy();if(token===privacyRenderToken)$('privacyOverlay').style.pointerEvents=privacyPageReady?'':'none';}
}
$('privacyOpen').onclick=()=>{if(!pages.length)return;$('privacyDialog').showModal();void showPrivacyPage(pages.find(p=>p.uid===previewUid)||pages[0]);};
$('privacyClose').onclick=$('privacyDone').onclick=()=>$('privacyDialog').close();
$('privacyDialog').addEventListener('close',()=>{finishPrivacyGesture(true);privacyRenderToken++;privacyRenderTask?.cancel();privacyPageReady=false;$('privacyOverlay').style.pointerEvents='none';$('privacyCanvas').width=$('privacyCanvas').height=0;renderAnnots();toolsChanged();syncCounts();});
for(const [id,step]of [['privacyPrev',-1],['privacyNext',1]])$(id).onclick=()=>{const p=pages[pages.indexOf(privacyPage)+step];if(p)void showPrivacyPage(p);};
const privacyPoint=e=>{const r=$('privacyOverlay').getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
$('privacyOverlay').addEventListener('pointerdown',e=>{
  if(!privacyPage||!privacyPageReady||e.button>0)return;const point=privacyPoint(e),handle=e.target.dataset.maskHandle,hit=e.target.dataset.maskId;
  if(hit||handle){privacySelection=hit||privacySelection;const a=privacyPage.annots.find(a=>a.id===privacySelection);if(!a)return;e.preventDefault();privacyGesture={a,point,mode:handle?'resize':'move',handle,snapshot:{...a},before:captureEditHistory(),pointer:e.pointerId,page:privacyPage};$('privacyOverlay').setPointerCapture(e.pointerId);renderPrivacyOverlay();return;}
  e.preventDefault();const a={id:'a'+(++annoUidSeq),shape:'redaction',nx:point.x,ny:point.y,nw:0,nh:0,fill:'#111111',stroke:'none',lineWidth:0,opacity:1};
  privacyGesture={a,point,before:captureEditHistory(),pointer:e.pointerId,page:privacyPage};(privacyPage.annots||=[]).push(a);privacySelection=a.id;$('privacyOverlay').setPointerCapture(e.pointerId);renderPrivacyOverlay();
});
$('privacyOverlay').addEventListener('pointermove',e=>{const g=privacyGesture;if(!g||g.pointer!==e.pointerId)return;const p=privacyPoint(e);
  if(g.mode==='move')Object.assign(g.a,{nx:Math.max(0,Math.min(1-g.a.nw,g.snapshot.nx+p.x-g.point.x)),ny:Math.max(0,Math.min(1-g.a.nh,g.snapshot.ny+p.y-g.point.y))});
  else if(g.mode==='resize'){const s=g.snapshot,x1=g.handle.includes('w')?p.x:s.nx,x2=g.handle.includes('e')?p.x:s.nx+s.nw,y1=g.handle.includes('n')?p.y:s.ny,y2=g.handle.includes('s')?p.y:s.ny+s.nh;Object.assign(g.a,{nx:Math.min(x1,x2),ny:Math.min(y1,y2),nw:Math.abs(x2-x1),nh:Math.abs(y2-y1)});}
  else Object.assign(g.a,{nx:Math.min(p.x,g.point.x),ny:Math.min(p.y,g.point.y),nw:Math.abs(p.x-g.point.x),nh:Math.abs(p.y-g.point.y)});renderPrivacyOverlay();});
function finishPrivacyGesture(cancel){const g=privacyGesture;if(!g)return;privacyGesture=null;if(cancel||g.a.nw<.003||g.a.nh<.003){if(g.snapshot)Object.assign(g.a,g.snapshot);else g.page.annots=g.page.annots.filter(a=>a!==g.a);privacySelection=null;}else commitEditHistory(g.before,'개인정보 마스킹');renderPrivacyOverlay();proInvalidate();}
$('privacyOverlay').addEventListener('pointerup',()=>finishPrivacyGesture(false));$('privacyOverlay').addEventListener('pointercancel',()=>finishPrivacyGesture(true));
$('privacyDelete').onclick=()=>{if(!privacyPage||!privacyPageReady||!privacySelection)return;const before=captureEditHistory();privacyPage.annots=privacyPage.annots.filter(a=>a.id!==privacySelection);privacySelection=null;commitEditHistory(before,'마스킹 영역 삭제');renderPrivacyOverlay();proInvalidate();};
$('privacyDialog').addEventListener('keydown',e=>{if(e.key==='Delete'&&!e.target.matches('input,textarea')){e.preventDefault();$('privacyDelete').click();}});
syncPrivacy();
