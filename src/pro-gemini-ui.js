'use strict';
ocrActionIds.push('geminiRun');
let geminiClicks=0,geminiCheck=null,geminiPending=null,geminiReady=false;
$('modePro').addEventListener('click',()=>{
  if(++geminiClicks!==8)return;
  $('geminiTools').hidden=false;$('ocrSection').open=true;
  $('geminiRun').scrollIntoView({block:'nearest',behavior:'smooth'});
  toast('Gemini 인식이 표시됩니다.');
});
$('geminiRun').onclick=async()=>{
  if($('geminiTools').hidden||ocrRunning||proAbort)return;
  const list=toolTargets($('geminiScope').value);if(!list.length){toast('인식할 페이지를 선택하세요.');return;}
  let options;try{options=readProOptions();}catch(e){toast(e.message,true);return;}
  geminiPending={list:[...list],fingerprint:proFingerprint(),keys:list.map(p=>ocrKey(p,options)),language:$('ocrLanguage').value};
  geminiReady=false;$('geminiConsent').checked=false;$('geminiConfirm').disabled=true;
  $('geminiConfirmScope').textContent=`${list.length}페이지를 인식합니다. 기존 텍스트가 있는 페이지는 전송하지 않습니다.`;
  $('geminiAvailability').textContent='연결 상태를 확인하는 중…';$('geminiDialog').showModal();
  const ctrl=new AbortController();geminiCheck?.abort();geminiCheck=ctrl;
  const timer=setTimeout(()=>ctrl.abort(),10000);
  try{
    const status=await PDFGemini.available(ctrl.signal);
    if(geminiCheck!==ctrl||!$('geminiDialog').open)return;
    geminiReady=!!status.available;
    $('geminiAvailability').textContent=geminiReady?'확인 후 인식을 시작할 수 있습니다.':'Gemini 연결이 아직 설정되지 않았습니다. 관리자에게 문의하세요.';
    $('geminiConfirm').disabled=!geminiReady||!$('geminiConsent').checked;
  }catch(e){if(geminiCheck===ctrl&&$('geminiDialog').open)$('geminiAvailability').textContent=e.name==='AbortError'?'연결을 확인하지 못했습니다. 잠시 후 다시 시도하세요.':e.message;}
  finally{clearTimeout(timer);}
};
$('geminiConsent').onchange=()=>{$('geminiConfirm').disabled=!geminiReady||!$('geminiConsent').checked;};
$('geminiDialog').addEventListener('close',()=>{geminiCheck?.abort();geminiCheck=null;geminiPending=null;geminiReady=false;$('geminiConsent').checked=false;$('geminiConfirm').disabled=true;});
$('geminiConfirm').onclick=()=>{
  if(!geminiReady||!$('geminiConsent').checked||!geminiPending||!$('geminiDialog').open||ocrRunning||proAbort)return;
  const pending=geminiPending;let options;try{options=readProOptions();}catch(e){toast(e.message,true);return;}
  if(pending.fingerprint!==proFingerprint()||pending.language!==$('ocrLanguage').value||pending.keys.some((key,i)=>key!==ocrKey(pending.list[i],options))){$('geminiDialog').close();toast('문서 또는 설정이 바뀌었습니다. 다시 확인해 주세요.',true);return;}
  $('geminiDialog').close();void runOCR(false,'gemini',pending.list,true);
};
syncToolsState();
