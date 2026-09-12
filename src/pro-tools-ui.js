'use strict';
// Tesseract remains the default; PP-OCRv5 is a local, explicit choice in both builds.
const PADDLE_EXPECTED_MODEL='PP-OCRv5/korean-mobile/5c6f574b8e2230adf4287b33e736d71b9fabd28e/det-e6f4fa85/browser-v1';
const PADDLE_MODEL_CACHE_TAG=PADDLE_EXPECTED_MODEL+'/spotting';
const OCR_LINE_POSITION_NOTE='줄 단위 위치라 단어 선택 영역은 실제 글자와 다를 수 있습니다. 원본 글꼴을 알 수 없어 내장 글꼴의 문자 폭으로 추정합니다.';
function ocrDefaultProvider(){return globalThis.PDFVision&&$('ocrProvider')?.value==='vision'?'vision':globalThis.PDFPaddleLoad&&$('ocrProvider')?.value==='paddle-v5'?'paddle-v5':'tesseract';}
function ocrValidWord(word){const b=word?.box;return typeof word?.text==='string'&&!!word.text.trim()&&Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]>=0&&b[1]>=0&&b[2]<=1&&b[3]<=1&&b[2]>b[0]&&b[3]>b[1];}
function ocrCanEmbed(r){return !!r&&!r.skipped&&Array.isArray(r.words)&&r.words.some(w=>w.text?.trim())&&r.words.filter(w=>w.text?.trim()).every(ocrValidWord)&&(r.source!=='paddle-v5'||r.canEmbed===true&&r.modelCacheTag===PADDLE_MODEL_CACHE_TAG);}
function ocrHasText(r){return !r.skipped&&(!!r.text?.trim()||!!r.words?.some(w=>w.text?.trim()));}
function ocrRecordCurrent(r,p,o){return !!p&&r.key===ocrKey(p,o)&&(r.source!=='paddle-v5'||r.skipped||r.modelCacheTag===PADDLE_MODEL_CACHE_TAG);}
function configureLocalOCR(){
  const paddle=ocrDefaultProvider()==='paddle-v5';
  $('ocrDescription').innerHTML='<strong>'+(paddle?'PP-OCRv5 · 경량 한국어':'Tesseract')+'</strong><br>원래 페이지 모습은 유지하고 검색용 텍스트를 추가합니다. 먼저 한 페이지를 인식해 품질을 확인하세요.';
  $('ocrProcessingNote').textContent=paddle?'한국어·영어를 기기에서 인식합니다. 경량 모델 약 18MB를 사용하며 GPU는 필요하지 않습니다. 인식 후 고급옵션에서 원문과 대조해 수정할 수 있습니다.':'한국어와 영어를 기기에서 인식합니다. 검색 가능한 텍스트가 있는 페이지는 건너뜁니다.';
  if(!ocrRecords.length)$('ocrStatus').textContent=paddle?'모델 준비와 인식에 시간이 걸릴 수 있습니다.':globalThis.PDFTesseractLoad?'처음 인식할 때 필요한 엔진 데이터를 준비합니다.':'인식 엔진과 한글·영어 데이터가 포함되어 오프라인에서도 사용할 수 있습니다.';
  $('ocrLanguage').closest('label').hidden=paddle;
  $('ocrLayout').closest('label').hidden=paddle;$('ocrLayout').disabled=paddle;
  if(ocrDefaultProvider()==='vision'){
    $('ocrDescription').innerHTML='<strong>Google Cloud Vision</strong><br>문서 전용 OCR로 글자와 단어 위치를 인식합니다.';
    $('ocrProcessingNote').textContent='Google 서버에서 처리합니다. 실행 전 문서 전송에 동의해야 하며, 프로젝트 사용량에 따라 요금이 발생할 수 있습니다.';
    $('ocrLayout').closest('label').hidden=true;$('ocrLayout').disabled=true;
    if(!ocrRecords.length)$('ocrStatus').textContent='최신 모델 채널 · 실행 전에 서버 연결을 확인합니다.';
  }
}
async function startPaddleSession(language,signal,onProgress,layout){
  if(globalThis.PDFPaddleLoad)await waitForOCR(globalThis.PDFPaddleLoad(),signal);
  signal.throwIfAborted();
  if(typeof globalThis.PDFPaddleV5?.session!=='function')throw new Error('Paddle 인식 엔진을 준비하지 못했습니다. 페이지를 새로 열어 다시 시도해 주세요.');
  if(globalThis.PDFPaddleV5.model!==PADDLE_EXPECTED_MODEL)throw new Error('Paddle 모델 버전이 일치하지 않습니다. 페이지를 새로 열어 주세요.');
  const session=await globalThis.PDFPaddleV5.session(language,signal,onProgress,layout);
  return {close:()=>session.close(),async recognize(canvas){
    const result=await session.recognize(canvas);signal.throwIfAborted();
    if(!result||typeof result.text!=='string')throw new Error('Paddle 인식 결과 형식을 확인하지 못했습니다.');
    if(result.model&&result.model!==PADDLE_EXPECTED_MODEL)throw new Error('인식 결과의 모델 버전이 일치하지 않습니다. 다시 인식해 주세요.');
    const stopped=result.stop_reason??result.stopReason;
    if(result.status&&result.status!=='complete'||stopped&&stopped!=='eos')throw new Error('Paddle 인식이 끝까지 완료되지 않았습니다. 페이지를 나누어 다시 시도해 주세요.');
    const actual=Array.isArray(result.words)?result.words:[],valid=actual.length>0&&actual.every(ocrValidWord);
    const words=valid?actual.map(word=>({...word,box:[...word.box]})):[];
    return {...result,words,canEmbed:valid,modelCacheTag:PADDLE_MODEL_CACHE_TAG,coordinateStatus:valid?'detected-lines':'unavailable',geometryNote:valid?'':'줄 위치를 확인하지 못했습니다. 텍스트는 저장할 수 있지만 검색용 PDF에는 포함하지 않습니다.'};
  }};
}
const ocrActionIds=['ocrSample','ocrRun','ocrProvider','ocrCorrect'];
// Completed pages survive a failed batch in memory, independently of accepted PDF text.
// One entry per page/provider; removed pages and explicit clear/reset release their text.
const ocrCheckpoints=new Map();
function waitForOCR(promise,signal){
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
    promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
    if(signal.aborted)abort();
  });
}
let toolsRevision=0,stampAsset=null,stampMarks=[],stampPositioning=false,stampSource=null,stampOriginal=null,stampPixels=null,stampUndoState=null,stampShowingSource=false;
let stampShelf=[],stampEditing=null,stampLoadSequence=0,ocrRecords=[],ocrAccepted=false,ocrRunning=false,toolsLastState='';
const stampControlIds=['stampScope','stampAnchor','stampX','stampY','stampWidth','stampOpacity'];
function toolsChanged(){toolsRevision++;proInvalidate();syncToolSummaries();scheduleLivePreview();}
function syncToolSummaries(){
  const marks=stampMarks.length+(stampAsset?1:0),recognized=ocrRecords.filter(ocrHasText).length;
  $('stampSummary').textContent=marks?`도장 ${marks}개 배치`:'사진에서 만들고, 원하는 곳에 찍기';
  $('stampSection').classList.toggle('has-settings',marks>0);
  $('ocrSummary').textContent=recognized?`${ocrAccepted?ocrRecords.filter(ocrCanEmbed).length:recognized}쪽 · ${ocrAccepted?'검색 텍스트 포함':'인식 결과 확인 중'}`:'스캔을 검색·복사 가능한 PDF로';
  $('ocrSection').classList.toggle('has-settings',recognized>0);
}
function toolDownload(data,name,type){const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),8000);}
function toolTargets(scope){return scope==='all'?pages:scope==='selected'?selected():[livePage()].filter(Boolean);}
function currentStamp(){
  if(!stampAsset)return null;
  return {...stampAsset,name:$('stampName').value.trim()||'내 도장',scope:$('stampScope').value,targets:toolTargets($('stampScope').value).map(p=>p.uid),anchor:$('stampAnchor').value,
    x:proNumberInput('stampX',0,2000),y:proNumberInput('stampY',0,2000),width:proNumberInput('stampWidth',3,300),opacity:proNumberInput('stampOpacity',5,100)/100};
}
function ocrKey(p,o){return JSON.stringify([PADDLE_MODEL_CACHE_TAG,p.uid,p.docId,p.srcIndex,p.rotation,p.annots,['optimize','maxDimension','jpegQuality','blackWhite','bwThreshold','contrast','whitePoint','rasterize','deskew','crop','margins','paper'].map(k=>o[k])]);}
function readToolOptions(o,strict=false){
  const mark=currentStamp();o.stamps=[...stampMarks,...(mark?[mark]:[])];
  const valid=ocrRecords.filter(r=>ocrRecordCurrent(r,pages.find(p=>p.uid===r.uid),o));
  const stale=ocrRecords.some(r=>pages.some(p=>p.uid===r.uid)&&!valid.includes(r));
  if(strict&&ocrAccepted&&stale)throw new Error('OCR 후 페이지 또는 보정 설정이 바뀌었습니다. 텍스트 인식에서 다시 인식하거나 결과를 지워 주세요.');
  o.ocr=ocrAccepted?valid.filter(ocrCanEmbed).map(r=>({...r,words:r.words.filter(w=>w.text?.trim())})):[];return o;
}
function syncToolsState(){
  if(ocrRunning)return;
  const activePages=new Set(pages.map(p=>p.uid));for(const [id,r] of ocrCheckpoints)if(!activePages.has(r.uid))ocrCheckpoints.delete(id);
  syncToolSummaries();
  for(const id of ocrActionIds)$(id).disabled=(id!=='ocrProvider'&&!pages.length)||!!proAbort;
  $('ocrCorrect').disabled=!!proAbort||!ocrRecords.some(r=>!r.skipped&&r.words?.length);
  const state=JSON.stringify([pages.map(p=>p.uid),previewUid,selected().map(p=>p.uid),toolsRevision]);
  if(state!==toolsLastState){if(stampAsset&&$('stampScope').value!=='all')proInvalidate();toolsLastState=state;renderStampMarks();}
  if(ocrRecords.length){
    let o;try{o=readProOptions();}catch(_){return;}
    const stale=ocrRecords.some(r=>!ocrRecordCurrent(r,pages.find(p=>p.uid===r.uid),o));
    $('ocrCorrect').disabled=stale||!!proAbort||!ocrRecords.some(r=>!r.skipped&&r.words?.length);
    $('ocrAccept').disabled=stale||!ocrRecords.some(ocrCanEmbed)||ocrAccepted;
    if(stale)$('ocrStatus').textContent='페이지 또는 보정 설정이 바뀌었습니다. 이전 인식은 저장하지 않습니다. 다시 인식해 주세요.';
    if(stale)$('ocrSummary').textContent='설정 변경 · 다시 인식 필요';
    else if(ocrAccepted)$('ocrStatus').textContent=`검색용 텍스트 ${ocrRecords.filter(ocrCanEmbed).length}쪽이 결과 PDF에 포함됩니다.`;
  }
}
function resetTools(){stampMarks=[];stampAsset=null;stampEditing=null;stampSource=stampOriginal=stampPixels=stampUndoState=null;ocrRecords=[];ocrCheckpoints.clear();ocrAccepted=false;$('stampActive').hidden=true;$('ocrResults').hidden=true;setStampPositioning(false);renderStampMarks();toolsChanged();}
function setStampPositioning(on){stampPositioning=on&&!!stampAsset;document.body.classList.toggle('stamp-positioning',stampPositioning);$('stampPlace').setAttribute('aria-pressed',String(stampPositioning));if(stampPositioning)setLivePreviewOpen(true);}
function renderStampMarks(){
  const host=$('stampPlacements');host.replaceChildren();
  stampMarks.forEach((mark,i)=>{
    const row=document.createElement('div');row.className='stamp-row';const img=document.createElement('img');img.src=mark.data;img.alt='';
    const label=document.createElement('span'),n=mark.scope==='all'?pages.length:mark.targets.filter(uid=>pages.some(p=>p.uid===uid)).length;
    label.textContent=`${mark.name} · ${n}쪽${mark.scope==='all'?' 전체':''}`;
    const edit=document.createElement('button');edit.className='btn quiet';edit.textContent='수정';edit.onclick=()=>{if(stampAsset){toast('현재 도장을 먼저 확정하거나 닫아 주세요.');return;}stampEditing={mark,index:i};stampMarks.splice(i,1);activateStamp(mark);for(const [id,key] of [['stampScope','scope'],['stampAnchor','anchor'],['stampX','x'],['stampY','y'],['stampWidth','width']])$(id).value=mark[key];$('stampOpacity').value=mark.opacity*100;
      // Re-select the captured pages so editing retains the intended targets.
      if(mark.scope!=='all'){pages.forEach(p=>p.el?.classList.toggle('selected',mark.targets.includes(p.uid)));syncCounts();$('stampScope').value='selected';}toolsChanged();};
    const remove=document.createElement('button');remove.className='btn quiet';remove.textContent='삭제';remove.setAttribute('aria-label',`${mark.name} 배치 삭제`);remove.onclick=()=>{stampMarks.splice(i,1);renderStampMarks();toolsChanged();};row.append(img,label,edit,remove);host.append(row);
  });
}
function activateStamp(asset){stampAsset={...asset};$('stampThumb').src=asset.data;$('stampName').value=asset.name||'내 도장';$('stampActive').hidden=false;$('stampSection').open=true;toolsChanged();}
function stampSnapshot(){return {source:new ImageData(new Uint8ClampedArray(stampSource.data),stampSource.width,stampSource.height),pixels:new Uint8ClampedArray(stampPixels)};}
function stampPaint(){
  const c=$('stampCanvas');c.width=stampSource.width;c.height=stampSource.height;
  c.getContext('2d').putImageData(stampShowingSource?stampSource:new ImageData(stampPixels,c.width,c.height),0,0);
}
function stampReprocess(){if(!stampSource)return;stampUndoState=stampSnapshot();stampPixels=PDFStamp.removePaper(stampSource.data,{strength:Number($('stampStrength').value),color:$('stampColor').value});$('stampStrengthValue').value=$('stampStrength').value;stampPaint();}
function stampCrop(box){
  const x=Math.max(0,Math.floor(box.x)),y=Math.max(0,Math.floor(box.y)),w=Math.min(stampSource.width-x,Math.ceil(box.width)),h=Math.min(stampSource.height-y,Math.ceil(box.height));
  if(w<4||h<4)return;stampUndoState=stampSnapshot();
  function crop(data){const out=new Uint8ClampedArray(w*h*4);for(let j=0;j<h;j++)out.set(data.subarray(((y+j)*stampSource.width+x)*4,((y+j)*stampSource.width+x+w)*4),j*w*4);return out;}
  const source=crop(stampSource.data),pixels=crop(stampPixels);stampSource=new ImageData(source,w,h);stampPixels=pixels;stampPaint();
}
function openStampEditor(source){stampSource=new ImageData(new Uint8ClampedArray(source.data),source.width,source.height);stampOriginal=source;stampPixels=PDFStamp.removePaper(source.data,{strength:35});stampUndoState=null;stampShowingSource=false;$('stampShowSource').setAttribute('aria-pressed','false');$('stampStrength').value=35;$('stampStrengthValue').value=35;$('stampColor').value='original';$('stampEditorStatus').textContent='체크무늬는 투명한 영역입니다.';stampPaint();$('stampEditor').showModal();}
async function loadStampFile(file){
  if(!file)return;const seq=++stampLoadSequence;
  try{
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>40*1024*1024)throw new Error('40MB 이하의 PNG·JPG·WEBP 이미지를 선택하세요.');
    const image=await createImageBitmap(file);if(seq!==stampLoadSequence){image.close();return;}
    const scale=Math.min(1,1400/Math.max(image.width,image.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.width*scale));c.height=Math.max(1,Math.round(image.height*scale));
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,c.width,c.height);image.close();
    $('stampName').value=file.name.replace(/\.[^.]+$/,'').slice(0,30);openStampEditor(ctx.getImageData(0,0,c.width,c.height));c.width=c.height=0;
  }catch(e){toast(e.message||'도장 이미지를 읽지 못했습니다.',true);}
}
$('stampFile').onchange=e=>{const file=e.target.files[0];e.target.value='';loadStampFile(file);};
for(const ev of ['dragenter','dragover','dragleave','drop'])$('stampDrop').addEventListener(ev,e=>{e.preventDefault();e.stopPropagation();$('stampDrop').classList.toggle('over',ev==='dragenter'||ev==='dragover');if(ev==='drop')loadStampFile(e.dataTransfer.files[0]);});
$('stampEditorClose').onclick=()=>$('stampEditor').close();
$('stampStrength').oninput=stampReprocess;$('stampColor').onchange=stampReprocess;
$('stampTrim').onclick=()=>{const b=PDFStamp.bounds(stampPixels,stampSource.width,stampSource.height);if(b)stampCrop(b);else $('stampEditorStatus').textContent='남아 있는 획이 없습니다. 배경 제거를 낮추거나 원본부터 다시 시작하세요.';};
$('stampUndo').onclick=()=>{if(!stampUndoState)return;const current=stampSnapshot();stampSource=stampUndoState.source;stampPixels=stampUndoState.pixels;stampUndoState=current;stampPaint();};
$('stampResetImage').onclick=()=>{stampUndoState=stampSnapshot();stampSource=new ImageData(new Uint8ClampedArray(stampOriginal.data),stampOriginal.width,stampOriginal.height);stampPixels=PDFStamp.removePaper(stampSource.data,{strength:Number($('stampStrength').value),color:$('stampColor').value});stampPaint();};
$('stampRotate').onclick=()=>{stampUndoState=stampSnapshot();const {width:w,height:h}=stampSource;function rotate(data){const out=new Uint8ClampedArray(data.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++)out.set(data.subarray((y*w+x)*4,(y*w+x)*4+4),(x*h+h-1-y)*4);return out;}const source=rotate(stampSource.data),pixels=rotate(stampPixels);stampSource=new ImageData(source,h,w);stampPixels=pixels;stampPaint();};
$('stampShowSource').onclick=()=>{stampShowingSource=!stampShowingSource;$('stampShowSource').setAttribute('aria-pressed',String(stampShowingSource));stampPaint();};
let stampGesture=null;
function stampPoint(e){const r=$('stampCanvas').getBoundingClientRect();return {x:Math.max(0,Math.min(stampSource.width,(e.clientX-r.left)/r.width*stampSource.width)),y:Math.max(0,Math.min(stampSource.height,(e.clientY-r.top)/r.height*stampSource.height))};}
function stampBrushAt(p){const radius=Number($('stampBrush').value)/2,restore=$('stampTool').value==='restore',w=stampSource.width,h=stampSource.height;
  for(let y=Math.max(0,Math.floor(p.y-radius));y<Math.min(h,p.y+radius);y++)for(let x=Math.max(0,Math.floor(p.x-radius));x<Math.min(w,p.x+radius);x++)if(Math.hypot(x-p.x,y-p.y)<=radius){const i=(y*w+x)*4;if(restore)stampPixels.set(stampSource.data.subarray(i,i+4),i);else stampPixels[i+3]=0;}}
$('stampCanvas').onpointerdown=e=>{if(stampShowingSource)return;e.preventDefault();stampUndoState=stampSnapshot();stampGesture={start:stampPoint(e),last:stampPoint(e),id:e.pointerId};e.target.setPointerCapture(e.pointerId);if($('stampTool').value!=='crop'){stampBrushAt(stampGesture.start);stampPaint();}};
$('stampCanvas').onpointermove=e=>{if(!stampGesture||e.pointerId!==stampGesture.id)return;const p=stampPoint(e);if($('stampTool').value==='crop'){stampPaint();const c=$('stampCanvas').getContext('2d');c.strokeStyle='#008578';c.lineWidth=Math.max(1,stampSource.width/350);c.setLineDash([6,4]);c.strokeRect(stampGesture.start.x,stampGesture.start.y,p.x-stampGesture.start.x,p.y-stampGesture.start.y);}else{const d=Math.hypot(p.x-stampGesture.last.x,p.y-stampGesture.last.y),steps=Math.max(1,Math.ceil(d/3));for(let i=1;i<=steps;i++)stampBrushAt({x:stampGesture.last.x+(p.x-stampGesture.last.x)*i/steps,y:stampGesture.last.y+(p.y-stampGesture.last.y)*i/steps});stampPaint();}stampGesture.last=p;};
$('stampCanvas').onpointerup=e=>{if(!stampGesture||e.pointerId!==stampGesture.id)return;const p=stampPoint(e),a=stampGesture.start;if($('stampTool').value==='crop')stampCrop({x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),width:Math.abs(p.x-a.x),height:Math.abs(p.y-a.y)});stampGesture=null;stampPaint();};
$('stampCanvas').onpointercancel=()=>{if(stampGesture&&stampUndoState){stampSource=stampUndoState.source;stampPixels=stampUndoState.pixels;stampGesture=null;stampPaint();}};
$('stampUse').onclick=()=>{if(!PDFStamp.bounds(stampPixels,stampSource.width,stampSource.height)){$('stampEditorStatus').textContent='도장 획이 모두 지워졌습니다. 배경 제거를 낮춰 주세요.';return;}const c=document.createElement('canvas');c.width=stampSource.width;c.height=stampSource.height;c.getContext('2d').putImageData(new ImageData(stampPixels,c.width,c.height),0,0);const data=c.toDataURL('image/png');c.getContext('2d').putImageData(stampSource,0,0);const sourceData=c.toDataURL('image/png');activateStamp({data,sourceData,strength:Number($('stampStrength').value),color:$('stampColor').value,ratio:c.width/c.height,name:$('stampName').value});c.width=c.height=0;$('stampEditor').close();};
$('stampEdit').onclick=async()=>{if(!stampAsset)return;try{const asset=stampAsset,image=new Image();image.src=asset.sourceData||asset.data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);openStampEditor(ctx.getImageData(0,0,c.width,c.height));$('stampStrength').value=asset.strength??0;$('stampStrengthValue').value=asset.strength??0;$('stampColor').value=asset.color||'original';const processed=new Image();processed.src=asset.data;await processed.decode();ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(processed,0,0,c.width,c.height);stampPixels=ctx.getImageData(0,0,c.width,c.height).data;stampPaint();c.width=c.height=0;}catch(e){toast('도장 편집 이미지를 읽지 못했습니다.',true);}};
$('stampClear').onclick=()=>{if(stampEditing){stampMarks.splice(Math.min(stampEditing.index,stampMarks.length),0,stampEditing.mark);stampEditing=null;renderStampMarks();}stampAsset=null;$('stampActive').hidden=true;setStampPositioning(false);toolsChanged();};
$('stampPlace').onclick=()=>setStampPositioning(!stampPositioning);
$('stampCommit').onclick=()=>{try{const mark=currentStamp();if(!mark||!mark.targets.length){toast('도장을 배치할 페이지를 선택하세요.');return;}if(stampEditing)stampMarks.splice(Math.min(stampEditing.index,stampMarks.length),0,mark);else stampMarks.push(mark);stampEditing=null;stampAsset=null;$('stampActive').hidden=true;setStampPositioning(false);renderStampMarks();toolsChanged();$('stampStatus').textContent='배치를 확정했습니다. 결과 만들기로 PDF에 저장하세요.';}catch(e){toast(e.message,true);}};
for(const id of stampControlIds)$(id).oninput=()=>{toolsChanged();};
$('stampPng').onclick=async()=>{if(stampAsset)toolDownload(await (await fetch(stampAsset.data)).blob(),($('stampName').value||'도장')+'.png','image/png');};
function renderStampShelf(){const host=$('stampLibrary');host.replaceChildren();$('stampLibraryCount').textContent=stampShelf.length;
  stampShelf.forEach((s,i)=>{const row=document.createElement('div');row.className='stamp-row';const image=document.createElement('img');image.src=s.data;image.alt='';const name=document.createElement('span');name.textContent=s.name;const use=document.createElement('button');use.className='btn';use.textContent='사용';use.onclick=()=>activateStamp(s);const del=document.createElement('button');del.className='btn quiet';del.textContent='삭제';del.setAttribute('aria-label',s.name+' 보관 삭제');del.onclick=()=>{try{const next=stampShelf.filter((_,j)=>j!==i);localStorage.setItem('pdfstudio-stamps-v1',JSON.stringify(next));stampShelf=next;renderStampShelf();}catch(_){toast('보관함을 변경하지 못했습니다.',true);}};row.append(image,name,use,del);host.append(row);});}
try{const stored=JSON.parse(localStorage.getItem('pdfstudio-stamps-v1')||'[]');if(Array.isArray(stored))stampShelf=stored.filter(s=>typeof s.name==='string'&&typeof s.data==='string'&&/^data:image\/png;base64,/.test(s.data)&&(!s.sourceData||/^data:image\/png;base64,/.test(s.sourceData))&&Number.isFinite(s.ratio)&&s.ratio>0).slice(0,8);}catch(_){}renderStampShelf();
$('stampSave').onclick=()=>{if(!stampAsset)return;try{if(stampShelf.length>=8)throw new Error('최대 8개까지 보관할 수 있습니다. 사용하지 않는 도장을 삭제하세요.');const next=[...stampShelf,{data:stampAsset.data,sourceData:stampAsset.sourceData,strength:stampAsset.strength,color:stampAsset.color,ratio:stampAsset.ratio,name:$('stampName').value||'내 도장'}];localStorage.setItem('pdfstudio-stamps-v1',JSON.stringify(next));stampShelf=next;renderStampShelf();$('stampStatus').textContent='이 브라우저에 도장을 보관했습니다.';}catch(e){toast(e.name==='QuotaExceededError'?'브라우저 보관 용량이 부족합니다. PNG로 저장하세요.':e.message,true);}};
let placementGesture=null;
$('compareAfterScroll').addEventListener('pointerdown',e=>{
  if(!stampPositioning||e.target.id!=='compareAfter'||$('proCompare').getAttribute('aria-busy')==='true')return;
  let mark;try{mark=currentStamp();}catch(_){return;}if(!mark||!liveOutputSize)return;
  e.preventDefault();const r=e.target.getBoundingClientRect(),box=PDFStamp.placement(mark,liveOutputSize.width,liveOutputSize.height),x=(e.clientX-r.left)/r.width*liveOutputSize.width,y=(e.clientY-r.top)/r.height*liveOutputSize.height;
  const inside=x>=box.x&&x<=box.x+box.width&&y>=box.y&&y<=box.y+box.height;
  const ghost=document.createElement('div');ghost.className='stamp-drag-ghost';document.body.append(ghost);
  placementGesture={id:e.pointerId,r,box,dx:inside?x-box.x:box.width/2,dy:inside?y-box.y:box.height/2,ghost};e.target.setPointerCapture(e.pointerId);moveStamp(e);
});
function moveStamp(e){const g=placementGesture;if(!g||g.id!==e.pointerId)return;const w=liveOutputSize.width,h=liveOutputSize.height;
  g.x=Math.max(0,Math.min(w-g.box.width,(e.clientX-g.r.left)/g.r.width*w-g.dx));g.y=Math.max(0,Math.min(h-g.box.height,(e.clientY-g.r.top)/g.r.height*h-g.dy));
  Object.assign(g.ghost.style,{left:g.r.left+g.x/w*g.r.width+'px',top:g.r.top+g.y/h*g.r.height+'px',width:g.box.width/w*g.r.width+'px',height:g.box.height/h*g.r.height+'px'});
}
$('compareAfterScroll').addEventListener('pointermove',moveStamp);
$('compareAfterScroll').addEventListener('pointerup',e=>{const g=placementGesture;if(!g||g.id!==e.pointerId)return;moveStamp(e);$('stampAnchor').value='top-left';$('stampX').value=(g.x*25.4/72).toFixed(1);$('stampY').value=(g.y*25.4/72).toFixed(1);g.ghost.remove();placementGesture=null;toolsChanged();});
$('compareAfterScroll').addEventListener('pointercancel',()=>{placementGesture?.ghost.remove();placementGesture=null;});
async function runOCR(sample,provider=ocrDefaultProvider(),confirmedList=null,consent=false,force=false){
  if(ocrRunning||proAbort||!pages.length)return;
  if(!['tesseract','paddle-v5','gemini','vision'].includes(provider))return;
  if(provider==='vision'&&typeof PDFVision==='undefined')return;
  if(provider==='gemini'&&typeof PDFGemini==='undefined')return;
  if(['gemini','vision'].includes(provider)&&consent!==true){toast('민감정보 없는 문서임을 먼저 확인해 주세요.',true);return;}
  const list=[...(confirmedList||toolTargets(sample?'current':$('ocrScope').value))];if(!list.length){toast('인식할 페이지를 선택하세요.');return;}
  let o;try{o=readProOptions();}catch(e){toast(e.message,true);return;}
  o={...o,stamps:[],ocr:[],number:false,watermark:''};
  const snapshot=proFingerprint(),fresh=[],language=$('ocrLanguage').value,layout=$('ocrLayout').value,keys=list.map(p=>ocrKey(p,o));let engine=null,recognizingPage=0,position=0,reused=0,completed=0,status='',failed=false;
  const unchanged=()=>{const current=readProOptions();return snapshot===proFingerprint()&&language===$('ocrLanguage').value&&(provider!=='tesseract'||layout===$('ocrLayout').value)&&list.every((p,i)=>keys[i]===ocrKey(p,current));};
  const remember=(p,record)=>{if(pages.includes(p)&&ocrRecordCurrent(record,p,readProOptions()))ocrCheckpoints.set(provider+':'+p.uid,record);};
  if(force)for(const p of list)ocrCheckpoints.delete(provider+':'+p.uid);
  const update=n=>progress((position+Math.max(0,Math.min(1,n)))/list.length*95);
  let workStage='',recognizedMs=0,measuredPages=0;
  const timingKey=(provider==='paddle-v5'?PADDLE_MODEL_CACHE_TAG:provider)+':'+language+':'+layout;
  const stage=(name,known=true)=>{if(workStage!==name){workStage=name;globalThis.PDFWorkProgress?.phase(name,known);}};
  ocrRunning=true;for(const id of ocrActionIds)$(id).disabled=true;startProWork(provider==='gemini'?'Gemini 인식을 준비하는 중…':provider==='paddle-v5'?'PP-OCRv5 모델을 준비하는 중…':'텍스트 인식을 준비하는 중…');
  stage('문서 준비');
  const workController=proAbort,workSignal=workController.signal;
  $('ocrStatus').classList.remove('ocr-error');
  try{
    for(let i=0;i<list.length;i++){
      checkProAbort();position=i;const p=list[i],index=pages.indexOf(p);recognizingPage=index+1;const key=ocrKey(p,o);
      const matches=r=>r&&r.uid===p.uid&&r.key===key&&r.source===provider&&r.language===language&&(provider!=='tesseract'||r.layout===layout)&&!r.skipped&&(provider!=='paddle-v5'||ocrCanEmbed(r));
      const checkpoint=ocrCheckpoints.get(provider+':'+p.uid),cached=!force&&matches(checkpoint)&&checkpoint;
      if(cached){fresh.push({...cached,page:index+1});reused++;update(1);await idle();continue;}
      let pdfTask;
      // Include rendering and cleanup in the deadline, not just the network request.
      const pageTimer=provider==='tesseract'?null:setTimeout(()=>workController.abort(new Error((provider==='gemini'?'Gemini':provider==='vision'?'Google Vision':'Paddle')+' 페이지 처리 시간이 초과됐습니다. 완료한 결과는 유지됩니다. Tesseract로 다시 시도할 수 있습니다.')),['gemini','vision'].includes(provider)?120000:210000);
      try{
        // Preserve the existing searchable-text skip policy without serializing/reopening the PDF.
        // Shared PDF.js source reads can be cancelled without destroying the document being edited.
        const source=await waitForOCR(docs.get(p.docId).pdfjsDoc.getPage(p.srcIndex+1),proAbort.signal);
        const existing=p.annots?.some(a=>a.shape==='text'&&a.text?.trim())||(await waitForOCR(source.getTextContent(),proAbort.signal)).items.some(t=>t.str?.trim());
        checkProAbort();update(.05);
        if(existing){fresh.push({uid:p.uid,key,page:index+1,words:[],text:'검색 가능한 텍스트가 있어 건너뛰었습니다.',skipped:true,confidence:0,source:provider,language,layout});update(1);continue;}
        busy(true,`${index+1}쪽 · 인식용 페이지 준비 중…`);
        const doc=await waitForOCR(buildEditedDocument([p],{signal:workSignal}),workSignal);checkProAbort();
        const processed=await waitForOCR(PDFProPipeline.apply(doc,o,{signal:workSignal,docOptions:DOC_OPTS,pageOffset:index,pageIds:[p.uid]}),workSignal);checkProAbort();
        pdfTask=pdfjsLib.getDocument({data:await waitForOCR(processed.doc.save(),workSignal),...DOC_OPTS});const pdf=await waitForOCR(pdfTask.promise,workSignal),page=await waitForOCR(pdf.getPage(1),workSignal),base=page.getViewport({scale:1});
        const scale=Math.min(300/72,(provider==='paddle-v5'?2367:3400)/Math.max(base.width,base.height),Math.sqrt(9000000/(base.width*base.height))),vp=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
        try{
          const render=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:vp,background:'white'}),abort=()=>render.cancel();proAbort.signal.addEventListener('abort',abort,{once:true});try{await render.promise;}finally{proAbort.signal.removeEventListener('abort',abort);}checkProAbort();
          update(.12);
          if(!engine){
            const recognitionSignal=proAbort.signal;
            const onProgress=m=>{
              if(recognitionSignal.aborted||!ocrRunning)return;
              if(m.status==='loading assets'){
                stage('모델 준비');progress(m.progress*100);busy(true,m.detail||'인식 데이터를 준비하는 중…');return;
              }
              if(provider==='gemini'||provider==='vision'){
                stage('문서 인식',position>0);
                const label=m.status==='encoding page'?'전송할 이미지를 준비하는 중…':m.status==='reading result'?'인식 결과를 확인하는 중…':(provider==='vision'?'Google Vision':'Gemini')+'이 글자를 읽는 중…';
                busy(true,`${recognizingPage}쪽 · ${label} (${position+1}/${list.length})`);return;
              }
              if(provider==='paddle-v5'){
                if(m.status==='preparing engine')stage('인식 엔진 준비',false);
                const label=m.status==='recognizing text'?'Paddle 텍스트 인식 중':'Paddle 모델 준비 중';
                const detail=m.detail?' · '+String(m.detail):'';
                busy(true,recognizingPage+'쪽 · '+label+detail+' ('+(position+1)+'/'+list.length+')');
                if(m.status==='recognizing text'){stage('문서 인식');update(.12+Math.max(0,Math.min(1,m.progress||0))*.86);}
                return;
              }
              if(m.status==='recognizing text'){
                stage('문서 인식');
                const n=Math.max(0,Math.min(1,m.progress||0));update(.12+n*.86);
                busy(true,`${recognizingPage}쪽 글자 인식 · ${position+1}/${list.length}페이지`);
              }else busy(true,'텍스트 인식을 준비하는 중…');
            };
            engine=provider==='vision'?await PDFVision.session(language,recognitionSignal,onProgress,true):provider==='gemini'?await PDFGemini.session(language,recognitionSignal,onProgress,true):provider==='paddle-v5'?await startPaddleSession(language,recognitionSignal,onProgress,layout):await PDFOCR.session(language,recognitionSignal,onProgress,layout);
          }
          stage('문서 인식',provider==='tesseract'||provider==='paddle-v5');
          const expected=measuredPages?recognizedMs/measuredPages:globalThis.PDFWorkProgress?.previous(timingKey);
          if(!['tesseract','paddle-v5'].includes(provider)&&expected){globalThis.PDFWorkProgress?.estimate(expected*(list.length-position));globalThis.PDFWorkProgress?.plan(position/list.length*95,(position+1)/list.length*95,expected);}
          const recognizedAt=performance.now();
          const result=await waitForOCR(engine.recognize(canvas),workSignal);checkProAbort();
          recognizedMs+=performance.now()-recognizedAt;measuredPages++;
          globalThis.PDFWorkProgress?.sample(timingKey,performance.now()-recognizedAt);
          const record={...result,source:provider,language,layout,uid:p.uid,key,page:index+1};fresh.push(record);remember(p,record);completed++;
        }finally{canvas.width=canvas.height=0;}
      }finally{clearTimeout(pageTimer);if(pdfTask)await waitForOCR(pdfTask.destroy(),AbortSignal.timeout(2000)).catch(()=>{});}
      progress((i+1)/list.length*95);await idle();
    }
    if(!unchanged())throw new Error('처리 중 문서 또는 설정이 바뀌었습니다. 다시 인식해 주세요.');
    const merged=new Map(ocrRecords.map(r=>[r.uid,r]));for(const r of fresh)merged.set(r.uid,r);
    const current=readProOptions();let outdated=0;
    ocrRecords=pages.flatMap((p,i)=>{const r=merged.get(p.uid);if(!r)return [];if(!ocrRecordCurrent(r,p,current)){outdated++;return [];}return [{...r,page:i+1}];});ocrAccepted=false;renderOCRResults();toolsChanged();
    const skipped=fresh.filter(r=>r.skipped).length;
    status=`${provider==='gemini'?'Gemini · ':provider==='paddle-v5'?'PP-OCRv5 · ':''}${fresh.length-skipped}쪽 인식${reused?' (이전 결과 '+reused+'쪽 재사용)':''} · 기존 텍스트 ${skipped}쪽 건너뜀.${outdated?' 설정이 바뀐 이전 결과 '+outdated+'쪽은 제외했습니다.':''}${ocrRecords.some(ocrCanEmbed)?' 내용을 확인한 뒤 PDF 포함을 선택하세요.':fresh.some(ocrHasText)?' 텍스트는 저장할 수 있지만 검색용 PDF에 포함할 위치 정보가 없습니다.':' 기존 검색 텍스트를 유지합니다.'}`;
  }catch(e){
    if(workSignal.aborted)e=workSignal.reason;
    failed=e.name!=='AbortError';
    const message=e.name==='AbortError'?'텍스트 인식을 취소했습니다.':e.message||'텍스트 인식에 실패했습니다.';
    let resumable=false;try{resumable=unchanged();}catch(_){}
    status=message+(resumable&&completed+reused?` 완료한 ${completed+reused}쪽은 이 탭에서 보관합니다. 다시 인식하면 완료한 페이지를 재사용합니다.`:'')+(ocrRecords.length?' 이전 인식 결과는 유지됩니다.':'');
    if(e.retryAfter)status+=` 약 ${Math.ceil(e.retryAfter)}초 뒤 다시 시도하세요.`;
    toast(message,e.name!=='AbortError');
  }finally{
    try{if(engine)await waitForOCR(engine.close(),AbortSignal.timeout(2000)).catch(()=>{});}finally{ocrRunning=false;finishProWork();if(status)$('ocrStatus').textContent=status;$('ocrStatus').classList.toggle('ocr-error',failed);if(failed){$('ocrSection').open=true;$('ocrStatus').scrollIntoView({block:'nearest',behavior:'smooth'});}}
  }
}
function renderOCRResults(){
  $('ocrResults').hidden=!ocrRecords.length;$('ocrResultPage').replaceChildren();
  ocrRecords.forEach((r,i)=>{const option=document.createElement('option');option.value=i;option.textContent=`${r.page}쪽${r.skipped?' · 기존 텍스트 유지':!ocrHasText(r)?' · 인식한 글자 없음':!ocrCanEmbed(r)?' · 텍스트만 · 위치 없음':''}`;$('ocrResultPage').append(option);});renderOCRText();
}
function renderOCRText(){const host=$('ocrText');host.replaceChildren();const r=ocrRecords[Number($('ocrResultPage').value)];if(!r)return;
  if(r.skipped||!r.words.length)host.textContent=r.text;else for(const word of r.words){const span=document.createElement('span');span.textContent=word.text+(word.separator??' ');if(!word.corrected&&(word.uncertain||(Number.isFinite(word.confidence)&&word.confidence<70))){span.className='uncertain';span.title=r.source==='gemini'||r.source==='paddle-v5'?'확인이 필요한 글줄':`엔진 확신도 ${Math.round(word.confidence)}`;}host.append(span);}
  $('ocrConfidence').textContent=r.skipped?'이 페이지에는 새 OCR을 추가하지 않습니다.':r.source==='paddle-v5'?(ocrCanEmbed(r)?'PP-OCRv5 · '+r.words.length+'개 글줄 · 엔진 확신도 '+Math.round(r.confidence||0)+' / 100 · '+OCR_LINE_POSITION_NOTE:r.geometryNote||'줄 위치가 없어 텍스트 저장만 가능합니다. 검색용 PDF에는 포함하지 않습니다.'):r.source==='gemini'?`Gemini · ${r.words.length}개 글줄 · 글자와 추정 위치를 확인해 주세요.`:`인식 ${r.words.length}단어 · 엔진 확신도 ${Math.round(r.confidence)} / 100 · 확인 필요 ${r.words.filter(w=>w.confidence<70).length}단어`;
  $('ocrConfidenceNote').textContent=r.source==='paddle-v5'?'밑줄은 확인이 필요한 글줄입니다. 확신도는 실제 정확도와 다릅니다. '+OCR_LINE_POSITION_NOTE:r.source==='gemini'?'밑줄은 확인이 필요한 글줄입니다. '+OCR_LINE_POSITION_NOTE:'밑줄은 엔진 확신도가 낮은 단어입니다. 확신도는 실제 정확도와 다릅니다.';
  if(r.source==='vision'&&!r.skipped)$('ocrConfidence').textContent=`Google Vision · ${r.words.length}단어 · 단어 위치 포함`+(Number.isFinite(r.confidence)?` · 엔진 확신도 ${Math.round(r.confidence)} / 100`:'');
  if(r.correctionLines?.length)$('ocrConfidenceNote').textContent+=` 크게 고친 ${r.correctionLines.length}개 줄은 원래 글줄 범위 안에서 글자 위치를 추정해 저장합니다.`;
}
async function renderOCRCorrectionPage(record,{signal}={}){
  const p=pages.find(p=>p.uid===record.uid),options=readProOptions();
  if(!ocrRecordCurrent(record,p,options))throw new Error('페이지 또는 보정 설정이 바뀌었습니다. 다시 인식해 주세요.');
  const currentSignal=signal||AbortSignal.timeout(60000),index=pages.indexOf(p);
  const o={...options,stamps:[],ocr:[],number:false,watermark:''};let task,canvas;
  try{
    const doc=await waitForOCR(buildEditedDocument([p],{signal:currentSignal}),currentSignal);
    const processed=await waitForOCR(PDFProPipeline.apply(doc,o,{signal:currentSignal,docOptions:DOC_OPTS,pageOffset:index,pageIds:[p.uid]}),currentSignal);
    task=pdfjsLib.getDocument({data:await waitForOCR(processed.doc.save(),currentSignal),...DOC_OPTS});
    const pdf=await waitForOCR(task.promise,currentSignal),page=await waitForOCR(pdf.getPage(1),currentSignal),base=page.getViewport({scale:1});
    const vp=page.getViewport({scale:Math.min(300/72,2367/Math.max(base.width,base.height),Math.sqrt(9000000/(base.width*base.height)))});
    canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
    const render=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:vp,background:'white'}),abort=()=>render.cancel();
    currentSignal.addEventListener('abort',abort,{once:true});
    try{await waitForOCR(render.promise,currentSignal);}finally{currentSignal.removeEventListener('abort',abort);}
    currentSignal.throwIfAborted();
    if(!ocrRecordCurrent(record,p,readProOptions()))throw new Error('문서가 변경되었습니다. 다시 인식해 주세요.');
    return canvas;
  }catch(e){if(canvas)canvas.width=canvas.height=0;throw e;}
  finally{if(task)await waitForOCR(task.destroy(),AbortSignal.timeout(2000)).catch(()=>{});}
}
$('ocrCorrect').onclick=async()=>{
  if($('ocrCorrect').disabled||ocrRunning||proAbort)return;
  try{
    const original=ocrRecords;
    await PDFOCRCorrection.open({records:original,initialIndex:Number($('ocrResultPage').value)||0,renderPage:renderOCRCorrectionPage,onApply:edited=>{
      const options=readProOptions();
      if(ocrRecords!==original||edited.some(r=>!ocrRecordCurrent(r,pages.find(p=>p.uid===r.uid),options)))throw new Error('문서 또는 인식 결과가 바뀌었습니다. 교정 창을 다시 열어 주세요.');
      ocrRecords=edited;
      for(const record of edited)if(!record.skipped)ocrCheckpoints.set(record.source+':'+record.uid,record);
      ocrAccepted=false;const index=$('ocrResultPage').value;
      renderOCRResults();$('ocrResultPage').value=index;renderOCRText();toolsChanged();syncToolsState();
      $('ocrStatus').textContent='교정한 결과를 반영했습니다. 확인 후 PDF에 포함해 주세요.';
    }});
  }catch(e){toast(e.message||'인식 교정 화면을 열지 못했습니다.',true);}
};
$('ocrProvider').onchange=()=>{configureLocalOCR();};
$('ocrSample').onclick=()=>ocrDefaultProvider()==='vision'?requestVisionOCR(true):runOCR(true);$('ocrRun').onclick=()=>ocrDefaultProvider()==='vision'?requestVisionOCR(false):runOCR(false);$('ocrResultPage').onchange=renderOCRText;
$('ocrAccept').onclick=()=>{if($('ocrAccept').disabled||!ocrRecords.some(ocrCanEmbed))return;ocrAccepted=true;toolsChanged();syncToolsState();};
$('ocrClear').onclick=()=>{ocrRecords=[];ocrCheckpoints.clear();ocrAccepted=false;renderOCRResults();toolsChanged();$('ocrStatus').textContent='인식 결과를 지웠습니다. 원본 문서는 유지됩니다.';};
$('ocrTxt').onclick=()=>toolDownload('\ufeff'+ocrRecords.map(r=>`[${r.page}쪽]\n${r.text}`).join('\n\n'),'인식한 텍스트.txt','text/plain;charset=utf-8');
configureLocalOCR();syncToolsState();
