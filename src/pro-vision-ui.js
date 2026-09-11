'use strict';
let visionCheck=null,visionPending=null,visionReady=false;
async function requestVisionOCR(sample){
  if(ocrRunning||proAbort||ocrDefaultProvider()!=='vision')return;
  const list=toolTargets(sample?'current':$('ocrScope').value);if(!list.length){toast('인식할 페이지를 선택하세요.');return;}
  let options;try{options=readProOptions();}catch(e){toast(e.message,true);return;}
  visionPending={list:[...list],fingerprint:proFingerprint(),keys:list.map(p=>ocrKey(p,options)),language:$('ocrLanguage').value};
  visionReady=false;$('visionConsent').checked=false;$('visionConfirm').disabled=true;
  $('visionConfirmScope').textContent=`${list.length}페이지를 확인합니다. 검색 가능한 텍스트가 있거나 이미 인식한 페이지는 전송하지 않습니다.`;
  $('visionAvailability').textContent='서버 연결을 확인하는 중…';$('visionDialog').showModal();
  const ctrl=new AbortController();visionCheck?.abort();visionCheck=ctrl;const timer=setTimeout(()=>ctrl.abort(),10000);
  try{const status=await PDFVision.available(ctrl.signal);if(visionCheck!==ctrl||!$('visionDialog').open)return;
    visionReady=!!status.available&&!status.retryAfter;
    $('visionAvailability').textContent=status.retryAfter?`호출 한도에 도달했습니다. ${status.retryAfter}초 뒤 다시 확인하세요.`:visionReady?'연결 설정이 있습니다. 동의 후 인식을 시작할 수 있습니다.':'서버 연결이 필요합니다. Cloudflare에 GOOGLE_VISION_API_KEY를 등록하고 Google Cloud 프로젝트에서 Vision API를 활성화해 주세요.';
    $('visionConfirm').disabled=!visionReady||!$('visionConsent').checked;
  }catch(e){if(visionCheck===ctrl&&$('visionDialog').open)$('visionAvailability').textContent=e.name==='AbortError'?'연결 확인 시간이 초과됐습니다.':e.message;}
  finally{clearTimeout(timer);}
}
$('visionConsent').onchange=()=>{$('visionConfirm').disabled=!visionReady||!$('visionConsent').checked;};
$('visionDialog').addEventListener('close',()=>{visionCheck?.abort();visionCheck=null;visionPending=null;visionReady=false;$('visionConsent').checked=false;$('visionConfirm').disabled=true;});
$('visionConfirm').onclick=()=>{
  if(!visionReady||!$('visionConsent').checked||!visionPending||!$('visionDialog').open||ocrRunning||proAbort)return;
  const pending=visionPending;let options;try{options=readProOptions();}catch(e){toast(e.message,true);return;}
  if(ocrDefaultProvider()!=='vision'||pending.fingerprint!==proFingerprint()||pending.language!==$('ocrLanguage').value||pending.keys.some((key,i)=>key!==ocrKey(pending.list[i],options))){$('visionDialog').close();toast('문서 또는 설정이 바뀌었습니다. 다시 확인해 주세요.',true);return;}
  $('visionDialog').close();void runOCR(false,'vision',pending.list,true);
};
