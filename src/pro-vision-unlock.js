'use strict';
// This is an Easter egg, intentionally not an authorization boundary.
let visionClicks=0,visionLastClick=0,visionUnlocked=false;
ocrActionIds.push('visionRun');
$('modePro').addEventListener('click',()=>{
  if(visionUnlocked||ocrRunning||proAbort)return;
  const now=Date.now();visionClicks=now-visionLastClick>2000?1:visionClicks+1;visionLastClick=now;
  if(visionClicks<8)return;
  visionClicks=0;$('visionUnlockError').textContent='';$('visionUnlockPassword').value='';
  if(!$('visionUnlockDialog').open)$('visionUnlockDialog').showModal();
});
$('visionUnlockCancel').onclick=()=>$('visionUnlockDialog').close();
$('visionUnlockDialog').addEventListener('close',()=>{$('visionUnlockPassword').value='';$('visionUnlockError').textContent='';visionClicks=0;});
$('visionUnlockPassword').addEventListener('input',()=>{$('visionUnlockError').textContent='';});
$('visionUnlockForm').addEventListener('submit',event=>{
  event.preventDefault();
  if($('visionUnlockPassword').value!=='rltnfchlrh'){
    $('visionUnlockError').textContent='비밀번호가 맞지 않습니다.';$('visionUnlockPassword').select();return;
  }
  if(ocrRunning||proAbort){$('visionUnlockError').textContent='현재 작업이 끝난 뒤 다시 시도하세요.';return;}
  visionUnlocked=true;
  const option=document.createElement('option');option.value='vision';option.textContent='Google Vision · 클라우드';$('ocrProvider').append(option);
  $('visionTools').hidden=false;$('ocrSection').open=true;$('ocrProvider').value='vision';configureLocalOCR();
  $('visionUnlockDialog').close();syncToolsState();$('visionRun').scrollIntoView({block:'nearest',behavior:'smooth'});
  toast('Google Vision이 활성화되었습니다.');
});
$('visionRun').onclick=()=>{
  if(!visionUnlocked||ocrRunning||proAbort)return;
  $('ocrProvider').value='vision';configureLocalOCR();void requestVisionOCR(false);
};
syncToolsState();
