/* Short processing-location status; detailed explanations use existing help. */
const processingBadge=document.querySelector('.brand-txt p');processingBadge.id='processingBadge';processingBadge.setAttribute('role','status');
const processingHelp=document.createElement('p');processingHelp.className='pro-hint';processingHelp.id='processingHelp';processingBadge.after(processingHelp);
function syncProcessingLocation(){
 if(typeof processingBadge==='undefined')return;
 const cloud=proMode==='pro'&&ocrDefaultProvider()==='vision';
 processingBadge.textContent=cloud?(ocrRunning?'클라우드 OCR 처리 중':'클라우드 OCR · 동의 필요'):'내 기기 처리';
 processingBadge.dataset.cloud=String(cloud);
 processingHelp.textContent=cloud?'기본 편집은 기기에서 처리합니다. Google Vision 실행 시 동의한 페이지의 이미지만 Cloudflare를 거쳐 Google로 전송합니다.':'기본 편집과 로컬 OCR은 기기에서 처리합니다. 문서 내용은 외부로 보내지 않습니다.';
 const localHint=document.querySelector('.dz-note');if(localHint)localHint.textContent='기본 편집·로컬 OCR은 내 기기에서 처리';
}
function syncOCRPreparation(){
 const note=$('ocrPreparation');if(!note)return;
 const provider=ocrDefaultProvider(),embedded=!!document.getElementById('ocr-client');
 note.hidden=provider==='vision';if(note.hidden)return;
 const ready=provider==='paddle-v5'?!!globalThis.PDFPaddleV5:!!globalThis.Tesseract;
 note.textContent=embedded?'엔진·모델 내장 · 인터넷 없이 준비':ready?'실행 코드 준비됨 · 인식 시작 시 모델 준비':'첫 실행 시 엔진·모델 준비 · 문서는 전송되지 않음';
 if(!embedded&&provider==='paddle-v5'&&globalThis.PDFOCRAssetInfo){const info=globalThis.PDFOCRAssetInfo;note.textContent+='\n모델 '+(info.modelBytes/1e6).toFixed(1)+' MB · 엔진 포함 '+(info.totalBytes/1e6).toFixed(1)+' MB (압축 전)';}
}
$('ocrProvider').addEventListener('change',()=>{syncProcessingLocation();syncOCRPreparation();});
for(const id of ['modeBasic','modePro'])$(id).addEventListener('click',()=>queueMicrotask(syncProcessingLocation));
syncProcessingLocation();syncOCRPreparation();
