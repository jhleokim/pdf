/* Per-page clockwise angles. Pointer previews are temporary; PDF work runs on release. */
(() => {
  'use strict';
  const clamp=value=>Math.round(Math.max(-60,Math.min(60,value))*10)/10;
  const signed=value=>(value>0?'+':'')+Number(value||0).toFixed(1)+'°';
  function sourceKey(page){
    // Keep measurement keys small even when a Basic annotation embeds an image.
    const value=JSON.stringify(page.annots||[]);let a=2166136261,b=5381;
    for(let i=0;i<value.length;i++){const n=value.charCodeAt(i);a=Math.imul(a^n,16777619);b=Math.imul(b,33)^n;}
    return JSON.stringify([page.uid,page.docId,page.srcIndex,page.rotation,value.length,a>>>0,b>>>0]);
  }
  function pointerAngle({x,y,cx,cy}){return Math.atan2(y-cy,x-cx)*180/Math.PI;}
  function gestureAngle(start,point){
    if(start.kind==='linear')return clamp(start.angle+(point.x-start.x)/Math.max(100,start.width)*120);
    let delta=pointerAngle({...point,cx:start.cx,cy:start.cy})-start.pointerAngle;
    delta=((delta+180)%360+360)%360-180;
    return clamp(start.angle+delta);
  }
  function previewFit(width,height,angle,availableWidth,availableHeight){
    const radians=angle*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
    return Math.max(.001,Math.min(availableWidth/(width*c+height*s),availableHeight/(width*s+height*c)));
  }
  globalThis.PDFDeskewUIModel=Object.freeze({clamp,signed,sourceKey,gestureAngle,previewFit});
  if(typeof document==='undefined'||!document.getElementById('proDeskewAngle'))return;
  const $=id=>document.getElementById(id),cache=new Map(),reports=new Map();
  let active=false,gesture=null,frame=0,ghostUid=null,ghostAngle=0,lastUid=null,invalid=false;
  const current=()=>typeof livePage==='function'?livePage():null;
  const manual=p=>Number.isFinite(p?.deskewAngle);
  const working=()=>!!proAbort||document.body.classList.contains('is-busy');
  const ready=()=>!!current()&&$('compareAfter').width>0&&$('compareBefore').width>0&&$('proCompare').getAttribute('aria-busy')!=='true'&&!$('proCompare').hasAttribute('data-error');
  function automaticAngle(p){
    if(!p||!$('proDeskew').checked)return 0;
    const measured=cache.get(sourceKey(p)),report=reports.get(p.uid);
    return measured?-measured.angle:report?.key===sourceKey(p)&&report.result.mode==='auto'?report.result.displayAngle||0:0;
  }
  const pageAngle=p=>manual(p)?p.deskewAngle:automaticAngle(p);
  function clearGhost(){ghostUid=null;$('deskewGhost').hidden=true;$('deskewGhostCanvas').width=$('deskewGhostCanvas').height=0;}
  function renderGhost(angle){
    const canvas=$('deskewGhostCanvas'),stage=$('compareStage');if(!canvas.width)return;
    const fit=previewFit(canvas.width,canvas.height,angle,Math.max(1,stage.clientWidth-48),Math.max(1,stage.clientHeight-96));
    canvas.style.width=canvas.width+'px';canvas.style.height=canvas.height+'px';
    canvas.style.transform=`rotate(${angle}deg) scale(${fit})`;
    ghostAngle=angle;$('deskewGhost').hidden=false;updateHandles(angle);
  }
  function prepareGhost(p){
    const source=$('compareBefore'),canvas=$('deskewGhostCanvas');if(!source.width||!source.height)return false;
    const factor=Math.min(1,2048/Math.max(source.width,source.height),Math.sqrt(4000000/(source.width*source.height)));
    canvas.width=Math.max(1,Math.round(source.width*factor));canvas.height=Math.max(1,Math.round(source.height*factor));
    canvas.getContext('2d',{alpha:false}).drawImage(source,0,0,canvas.width,canvas.height);ghostUid=p.uid;return true;
  }
  function updateHandles(angle){
    const stage=$('compareStage'),cx=stage.clientWidth/2,cy=Math.max(45,(stage.clientHeight-52)/2),radius=Math.max(24,Math.min(stage.clientWidth/2-27,cy-26)),a=angle*Math.PI/180;
    const handle=$('deskewRotateHandle');handle.style.left=(cx+Math.sin(a)*radius)+'px';handle.style.top=(cy-Math.cos(a)*radius)+'px';
    for(const id of ['deskewRotateHandle','deskewDragStrip']){$(id).setAttribute('aria-valuenow',String(angle));$(id).setAttribute('aria-valuetext',signed(angle));}
    $('deskewDragValue').value=signed(angle);
  }
  function syncDeskewControls(){
    const p=current(),changed=p?.uid!==lastUid;
    if(changed||proMode!=='pro'||!proPreviewOpen||working()){
      cancelDeskewGesture();if(changed||proMode!=='pro'||!proPreviewOpen){active=false;clearGhost();}else if(working())clearGhost();
    }
    if(changed){lastUid=p?.uid||null;invalid=false;$('proDeskewAngle').removeAttribute('aria-invalid');}
    if(!p){cache.clear();reports.clear();}
    const has=!!p,isManual=manual(p),angle=gesture?.value??pageAngle(p),busy=working();
    $('proDeskewPageNumber').value=has?`${pages.indexOf(p)+1} / ${pages.length}쪽`:'페이지 없음';
    $('proDeskewPageMode').disabled=!has||busy;$('proDeskewPageMode').value=isManual?'manual':'auto';
    $('proDeskewPageMode').options[0].text=$('proDeskew').checked?'자동 · 기본 설정':'보정 끔 · 기본 설정';
    if(!invalid&&(document.activeElement!==$('proDeskewAngle')||gesture))$('proDeskewAngle').value=Number(angle).toFixed(1);
    if(!invalid)$('proDeskewAngle').removeAttribute('aria-invalid');
    $('proDeskewAngle').disabled=!has||busy||!isManual;
    $('proDeskewMinus').disabled=$('proDeskewPlus').disabled=!has||busy||!isManual;
    $('proDeskewMinus').disabled||=angle<=-60;$('proDeskewPlus').disabled||=angle>=60;
    $('proDeskewAdjust').disabled=$('compareDeskewToggle').disabled=!has||busy;
    $('proDeskewResetPage').disabled=!has||busy||!isManual;
    $('compareDeskewToggle').setAttribute('aria-pressed',String(active));$('proDeskewAdjust').setAttribute('aria-pressed',String(active));
    $('deskewInteraction').hidden=!active;document.body.classList.toggle('deskew-adjusting',active);
    $('deskewRotateHandle').disabled=!ready()||busy;
    $('deskewDragStrip').setAttribute('aria-disabled',String(!ready()||busy));
    const report=p&&reports.get(p.uid),result=p&&report?.key===sourceKey(p)?report.result:null;
    if(!invalid)$('proDeskewPageStatus').textContent=!has?'왼쪽 목록에서 조절할 페이지를 선택하세요.':isManual?`이 페이지에만 ${signed(p.deskewAngle)} 적용 · 다른 페이지의 각도는 유지됩니다.`:!$('proDeskew').checked?'기본 자동 보정이 꺼져 있습니다. 직접 조절은 사용할 수 있습니다.':result?.mode==='auto'?(result.angle?`자동으로 ${signed(result.displayAngle)} 보정합니다.`:result.reason||'원본 각도를 유지합니다.'):'글줄의 기울기를 확인하고 있습니다.';
    updateHandles(angle);
  }
  function changeAngle(value,{before,key=null,keepGhost=false}={}){
    const p=current();if(!p||working()||!Number.isFinite(value)||Math.abs(value)>60)return false;
    const history=before??(typeof captureEditHistory==='function'?captureEditHistory():null);
    p.deskewAngle=clamp(value);invalid=false;$('proDeskewAngle').removeAttribute('aria-invalid');
    if(!keepGhost)clearGhost();
    if(typeof commitEditHistory==='function')commitEditHistory(history,'페이지 기울기 조절',key);
    proInvalidate();syncProState();scheduleLivePreview();return true;
  }
  function setDeskewInteraction(on){
    cancelDeskewGesture();active=!!on&&!!current()&&!working();
    if(active){
      if(typeof setStampPositioning==='function')setStampPositioning(false);
      setLivePreviewOpen(true);
      originalHover=originalPinned=false;showOriginal();
    }else clearGhost();
    syncDeskewControls();
  }
  function beginGesture(event,kind){
    if(event.button!==0||!event.isPrimary||!active||!ready()||working()||gesture)return;
    event.preventDefault();event.stopPropagation();
    const p=current(),stage=$('compareStage').getBoundingClientRect(),node=event.currentTarget;
    if(!prepareGhost(p))return;
    const cx=stage.left+stage.width/2,cy=stage.top+Math.max(45,(stage.height-52)/2),angle=pageAngle(p);
    gesture={kind,pointer:event.pointerId,node,uid:p.uid,x:event.clientX,y:event.clientY,cx,cy,angle,value:angle,width:node.clientWidth,pointerAngle:pointerAngle({x:event.clientX,y:event.clientY,cx,cy}),before:typeof captureEditHistory==='function'?captureEditHistory():null,moved:false};
    node.setPointerCapture(event.pointerId);cancelLivePreview();document.body.classList.add('deskew-gesture-active');renderGhost(angle);
  }
  function moveGesture(event){
    if(!gesture||event.pointerId!==gesture.pointer)return;event.preventDefault();
    if(current()?.uid!==gesture.uid){cancelDeskewGesture();return;}
    if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<3&&!gesture.moved)return;
    gesture.moved=true;gesture.value=gestureAngle(gesture,{x:event.clientX,y:event.clientY});
    if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(gesture){renderGhost(gesture.value);$('proDeskewAngle').value=gesture.value.toFixed(1);}});
  }
  function detachGesture(){
    const saved=gesture;gesture=null;if(frame){cancelAnimationFrame(frame);frame=0;}
    if(saved?.node.hasPointerCapture?.(saved.pointer))saved.node.releasePointerCapture(saved.pointer);
    document.body.classList.remove('deskew-gesture-active');return saved;
  }
  function cancelDeskewGesture(){
    if(!gesture)return false;detachGesture();clearGhost();updateHandles(pageAngle(current()));
    $('proDeskewAngle').value=pageAngle(current()).toFixed(1);return true;
  }
  function endGesture(event){
    if(!gesture||event.pointerId!==gesture.pointer)return;moveGesture(event);const saved=detachGesture();
    if(!saved.moved||saved.value===saved.angle||current()?.uid!==saved.uid){clearGhost();syncDeskewControls();scheduleLivePreview();return;}
    renderGhost(saved.value);changeAngle(saved.value,{before:saved.before,keepGhost:true});
  }
  function autoPage(){
    const p=current();if(!p||working())return;setDeskewInteraction(false);
    const before=typeof captureEditHistory==='function'?captureEditHistory():null;delete p.deskewAngle;
    if(typeof commitEditHistory==='function')commitEditHistory(before,'자동 기울기 보정으로 전환');
    invalid=false;proInvalidate();syncProState();scheduleLivePreview();
  }
  function resetPageDeskewAngles(){
    setDeskewInteraction(false);const before=typeof captureEditHistory==='function'?captureEditHistory():null;
    for(const p of pages)delete p.deskewAngle;
    if(typeof commitEditHistory==='function')commitEditHistory(before,'페이지별 기울기 초기화');invalid=false;
  }
  function acceptDeskewPreview(uid,result){
    const p=pages.find(page=>page.uid===uid);if(!p)return;
    if(result)reports.set(uid,{key:sourceKey(p),result});
    while(reports.size>128)reports.delete(reports.keys().next().value);
    if(ghostUid===uid&&!gesture)clearGhost();syncDeskewControls();
  }
  function deskewPreviewFailed(){clearGhost();syncDeskewControls();}
  function deskewCallbacks(subset){return {deskewCache:cache,deskewKeys:subset.map(sourceKey)};}
  function validateDeskewInput(){if(invalid&&manual(current())){$('proDeskewAngle').focus();throw new RangeError('페이지 기울기는 −60°부터 +60°까지 입력하세요.');}}
  Object.assign(globalThis,{syncDeskewControls,setDeskewInteraction,cancelDeskewGesture,resetPageDeskewAngles,acceptDeskewPreview,deskewPreviewFailed,deskewCallbacks,validateDeskewInput,deskewGestureActive:()=>!!gesture});
  $('proDeskewPageMode').addEventListener('change',()=>{$('proDeskewPageMode').value==='auto'?autoPage():changeAngle(pageAngle(current()));});
  $('proDeskewAngle').addEventListener('input',()=>{
    const input=$('proDeskewAngle'),value=Number(input.value);
    if(input.value.trim()===''||!Number.isFinite(value)||Math.abs(value)>60){invalid=true;input.setAttribute('aria-invalid','true');$('proDeskewPageStatus').textContent='−60°부터 +60°까지 입력하세요. 마지막 유효한 각도를 유지합니다.';return;}
    changeAngle(value,{key:current()?.uid+':deskew-input'});
  });
  $('proDeskewAngle').addEventListener('blur',syncDeskewControls);
  $('proDeskewAngle').addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();invalid=false;$('proDeskewAngle').removeAttribute('aria-invalid');$('proDeskewAngle').blur();syncDeskewControls();}if(event.key==='Enter')$('proDeskewAngle').blur();});
  for(const [id,step] of [['proDeskewMinus',-.1],['proDeskewPlus',.1]])$(id).addEventListener('click',()=>changeAngle(clamp(pageAngle(current())+step),{key:current()?.uid+':deskew-step'}));
  $('proDeskewResetPage').addEventListener('click',autoPage);
  $('proDeskewAdjust').addEventListener('click',()=>{setDeskewInteraction(!active);if(active&&innerWidth<=880)$('proCompare').scrollIntoView({behavior:'smooth',block:'center'});});
  $('compareDeskewToggle').addEventListener('click',()=>setDeskewInteraction(!active));
  $('deskewFinish').addEventListener('click',()=>{setDeskewInteraction(false);$('compareDeskewToggle').focus();});
  for(const [id,kind] of [['deskewRotateHandle','rotate'],['deskewDragStrip','linear']]){
    const node=$(id);node.addEventListener('pointerdown',event=>beginGesture(event,kind));node.addEventListener('pointermove',moveGesture);node.addEventListener('pointerup',endGesture);
    node.addEventListener('pointercancel',()=>{if(cancelDeskewGesture()){syncDeskewControls();scheduleLivePreview();}});
    node.addEventListener('lostpointercapture',()=>{if(gesture?.node===node){cancelDeskewGesture();syncDeskewControls();scheduleLivePreview();}});
    node.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)||!ready()||working())return;
      event.preventDefault();const step=event.shiftKey?1:.1,value=event.key==='Home'?0:pageAngle(current())+(['ArrowRight','ArrowUp'].includes(event.key)?step:-step);
      changeAngle(clamp(value),{key:current()?.uid+':deskew-key'});
    });
  }
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!active||document.querySelector('dialog[open]'))return;
    event.preventDefault();event.stopImmediatePropagation();if(cancelDeskewGesture()){syncDeskewControls();scheduleLivePreview();}else setDeskewInteraction(false);
  },true);
  $('proDeskew').addEventListener('input',()=>{invalid=false;syncDeskewControls();});
  new ResizeObserver(()=>{if(gesture)cancelDeskewGesture();if(ghostUid)clearGhost();syncDeskewControls();}).observe($('compareStage'));
  syncDeskewControls();
})();
