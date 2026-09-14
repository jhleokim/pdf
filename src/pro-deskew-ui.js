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
  function gestureAngle(start,point){
    // The scale follows the finger; the fixed centre indicator reads its value.
    return clamp(start.angle-(point.x-start.x)/10);
  }
  function previewFit(width,height,angle,availableWidth,availableHeight){
    const radians=angle*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
    return Math.max(.001,Math.min(availableWidth/(width*c+height*s),availableHeight/(width*s+height*c)));
  }
  function previewLayout(width,height,angle,availableWidth,availableHeight,crop=false){
    const r=angle*Math.PI/180,c=Math.abs(Math.cos(r)),s=Math.abs(Math.sin(r));
    const expandedWidth=width*c+height*s,expandedHeight=width*s+height*c;
    const k=crop?Math.min(width/expandedWidth,height/expandedHeight):1;
    const w=crop?width*k:expandedWidth,h=crop?height*k:expandedHeight;
    const scale=Math.max(.001,Math.min(availableWidth/w,availableHeight/h));
    return {scale,width:w*scale,height:h*scale,retainedAreaRatio:k*k};
  }
  globalThis.PDFDeskewUIModel=Object.freeze({clamp,signed,sourceKey,gestureAngle,previewFit,previewLayout});
  if(typeof document==='undefined'||!document.getElementById('proDeskewAngle'))return;
  const $=id=>document.getElementById(id),cache=new Map(),reports=new Map();
  let active=false,gesture=null,frame=0,ghostUid=null,ghostAngle=0,lastUid=null,invalid=null;
  const angleInputs=['proDeskewAngle','deskewDialAngle'];
  const current=()=>typeof livePage==='function'?livePage():null;
  const manual=p=>Number.isFinite(p?.deskewAngle);
  const working=()=>!!proAbort||document.body.classList.contains('is-busy');
  const ready=()=>{const p=current();return !!p&&$('compareAfter').width>0&&$('compareBefore').width>0&&($('proCompare').getAttribute('aria-busy')!=='true'||reports.get(p.uid)?.key===sourceKey(p))&&!$('proCompare').hasAttribute('data-error');};
  function automaticAngle(p){
    if(!p||!$('proDeskew').checked)return 0;
    const measured=cache.get(sourceKey(p)),report=reports.get(p.uid);
    return measured?-measured.angle:report?.key===sourceKey(p)&&report.result.mode==='auto'?report.result.displayAngle||0:0;
  }
  const pageAngle=p=>manual(p)?p.deskewAngle:automaticAngle(p);
  function clearGhost(){ghostUid=null;$('deskewGhost').hidden=true;$('deskewCropMask').hidden=true;$('deskewGhostCanvas').width=$('deskewGhostCanvas').height=0;}
  function placeBox(node,x,y,width,height){Object.assign(node.style,{left:x+'px',top:y+'px',width:width+'px',height:height+'px'});node.hidden=false;}
  function syncPreviewLayout(){
    const stage=$('compareStage'),area=$('deskewPreviewArea');
    if(active&&innerWidth<=880)$('proCompare').style.setProperty('--deskew-mobile-height',Math.max(360,(document.querySelector('main')?.clientHeight||innerHeight-170)-8)+'px');
    stage.style.setProperty('--deskew-dock-height',active?$('deskewDock').offsetHeight+'px':'0px');
    if(!active){$('deskewGuides').hidden=true;return;}
    if(ghostUid){renderGhost(ghostAngle);return;}
    const canvas=$('compareAfter'),r=canvas.getBoundingClientRect(),a=area.getBoundingClientRect();
    if(!canvas.width||!r.width||!r.height||r.height>a.height||r.width>a.width){$('deskewGuides').hidden=true;return;}
    placeBox($('deskewGuides'),r.left-a.left,r.top-a.top,r.width,r.height);
  }
  function renderGhost(angle){
    const canvas=$('deskewGhostCanvas'),area=$('deskewPreviewArea');if(!canvas.width)return;
    const crop=current()?.deskewCrop===true,layout=previewLayout(canvas.width,canvas.height,angle,Math.max(1,area.clientWidth-40),Math.max(1,area.clientHeight-40),crop);
    canvas.style.width=canvas.width+'px';canvas.style.height=canvas.height+'px';
    canvas.style.transform=`translate(-50%,-50%) rotate(${angle}deg) scale(${layout.scale})`;
    $('deskewGhostPaper').style.width=layout.width+'px';$('deskewGhostPaper').style.height=layout.height+'px';
    const x=(area.clientWidth-layout.width)/2,y=(area.clientHeight-layout.height)/2;
    placeBox($('deskewGuides'),x,y,layout.width,layout.height);
    if(crop)placeBox($('deskewCropMask'),x,y,layout.width,layout.height);else $('deskewCropMask').hidden=true;
    ghostAngle=angle;$('deskewGhost').hidden=false;updateDial(angle);
  }
  function prepareGhost(p){
    const source=$('compareBefore'),canvas=$('deskewGhostCanvas');if(!source.width||!source.height)return false;
    const factor=Math.min(1,2048/Math.max(source.width,source.height),Math.sqrt(4000000/(source.width*source.height)));
    canvas.width=Math.max(1,Math.round(source.width*factor));canvas.height=Math.max(1,Math.round(source.height*factor));
    canvas.getContext('2d',{alpha:false}).drawImage(source,0,0,canvas.width,canvas.height);ghostUid=p.uid;return true;
  }
  function updateDial(angle){
    $('deskewDragStrip').setAttribute('aria-valuenow',String(angle));$('deskewDragStrip').setAttribute('aria-valuetext',signed(angle));
    $('deskewRulerTrack').style.transform=`translateX(${-angle*10}px)`;
    for(const id of angleInputs)if(invalid!==id&&(document.activeElement!==$(id)||gesture))$(id).value=Number(angle).toFixed(1);
    const p=current(),source=$('compareBefore'),ratio=reports.get(p?.uid)?.result.sourceRatio||source.width/Math.max(1,source.height)||1;
    const retained=previewLayout(ratio,1,angle,1,1,true).retainedAreaRatio;
    $('deskewCropHint').textContent=invalid==='deskewDialAngle'?'−60°부터 +60°까지 입력하세요. 마지막 유효한 각도를 유지합니다.':p?.deskewCrop===true?`원본 면적의 약 ${((1-retained)*100).toFixed(1)}% 제외`:'전체 내용 보존 · 페이지를 자르지 않습니다';
  }
  function syncDeskewControls(){
    const p=current(),changed=p?.uid!==lastUid;
    if(changed||proMode!=='pro'||!proPreviewOpen||working()){
      cancelDeskewGesture();if(changed||proMode!=='pro'||!proPreviewOpen){active=false;if(invalid==='deskewDialAngle'){invalid=null;$('deskewDialAngle').value=pageAngle(p).toFixed(1);}clearGhost();}else if(working())clearGhost();
    }
    if(changed){lastUid=p?.uid||null;invalid=null;}
    if(!p){cache.clear();reports.clear();}
    const has=!!p,isManual=manual(p),angle=gesture?.value??pageAngle(p),busy=working();
    $('proDeskewPageNumber').value=has?`${pages.indexOf(p)+1} / ${pages.length}쪽`:'페이지 없음';
    $('proDeskewPageMode').disabled=!has||busy;$('proDeskewPageMode').value=isManual?'manual':'auto';
    $('proDeskewPageMode').options[0].text=$('proDeskew').checked?'자동 · 기본 설정':'보정 끔 · 기본 설정';
    for(const id of angleInputs)if(invalid!==id)$(id).removeAttribute('aria-invalid');
    $('proDeskewAngle').disabled=!has||busy||!isManual;
    $('proDeskewMinus').disabled=$('proDeskewPlus').disabled=!has||busy||!isManual;
    $('proDeskewMinus').disabled||=angle<=-60;$('proDeskewPlus').disabled||=angle>=60;
    $('proDeskewAdjust').disabled=$('compareDeskewToggle').disabled=!has||busy;
    $('proDeskewResetPage').disabled=!has||busy||!isManual;
    $('proDeskewResetPage').textContent=$('proDeskew').checked?'자동으로':'기본값으로';
    $('compareDeskewToggle').setAttribute('aria-pressed',String(active));$('proDeskewAdjust').setAttribute('aria-pressed',String(active));
    $('deskewInteraction').hidden=!active;document.body.classList.toggle('deskew-adjusting',active);
    $('deskewDragStrip').setAttribute('aria-disabled',String(!ready()||busy));
    for(const id of ['deskewDialAngle','deskewDialMinus','deskewDialPlus','deskewDialReset','deskewDialAuto','deskewCropCorners'])$(id).disabled=!has||busy;
    $('deskewDialMinus').disabled||=angle<=-60;$('deskewDialPlus').disabled||=angle>=60;
    $('deskewDialAuto').textContent=$('proDeskew').checked?'자동':'기본값';
    $('deskewDialAuto').setAttribute('aria-pressed',String(!isManual));
    $('deskewCropCorners').checked=p?.deskewCrop===true;
    const report=p&&reports.get(p.uid),result=p&&report?.key===sourceKey(p)?report.result:null;
    if(!invalid)$('proDeskewPageStatus').textContent=!has?'왼쪽 목록에서 조절할 페이지를 선택하세요.':isManual?`이 페이지에만 ${signed(p.deskewAngle)} 적용 · 다른 페이지의 각도는 유지됩니다.`:!$('proDeskew').checked?'기본 자동 보정이 꺼져 있습니다. 직접 조절은 사용할 수 있습니다.':result?.mode==='auto'?(result.angle?`자동으로 ${signed(result.displayAngle)} 보정합니다.`:result.reason||'원본 각도를 유지합니다.'):'글줄의 기울기를 확인하고 있습니다.';
    updateDial(angle);syncPreviewLayout();
  }
  function changeAngle(value,{before,key=null,keepGhost=false}={}){
    const p=current();if(!p||working()||!Number.isFinite(value)||Math.abs(value)>60)return false;
    const history=before??(typeof captureEditHistory==='function'?captureEditHistory():null);
    p.deskewAngle=clamp(value);invalid=null;
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
    }else{if(invalid==='deskewDialAngle'){invalid=null;$('deskewDialAngle').value=pageAngle(current()).toFixed(1);}clearGhost();}
    syncDeskewControls();scheduleLivePreview();
    if(active&&innerWidth<=880&&typeof setProView==='function'){setProView('workspace');$('proCompare').scrollIntoView({behavior:'smooth',block:'start'});}
    if(active)$('deskewDragStrip').focus({preventScroll:true});
  }
  function beginGesture(event){
    if(event.button!==0||!event.isPrimary||!active||!ready()||working()||gesture)return;
    event.preventDefault();event.stopPropagation();
    const p=current(),node=event.currentTarget;
    if(!prepareGhost(p))return;
    const angle=pageAngle(p);
    gesture={pointer:event.pointerId,node,uid:p.uid,x:event.clientX,y:event.clientY,angle,value:angle,before:typeof captureEditHistory==='function'?captureEditHistory():null,moved:false};
    node.setPointerCapture(event.pointerId);cancelLivePreview();document.body.classList.add('deskew-gesture-active');renderGhost(angle);
  }
  function moveGesture(event){
    if(!gesture||event.pointerId!==gesture.pointer)return;event.preventDefault();
    if(current()?.uid!==gesture.uid){cancelDeskewGesture();return;}
    if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<3&&!gesture.moved)return;
    gesture.moved=true;gesture.value=gestureAngle(gesture,{x:event.clientX,y:event.clientY});
    if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(gesture)renderGhost(gesture.value);});
  }
  function detachGesture(){
    const saved=gesture;gesture=null;if(frame){cancelAnimationFrame(frame);frame=0;}
    if(saved?.node.hasPointerCapture?.(saved.pointer))saved.node.releasePointerCapture(saved.pointer);
    document.body.classList.remove('deskew-gesture-active');return saved;
  }
  function cancelDeskewGesture(){
    if(!gesture)return false;detachGesture();clearGhost();updateDial(pageAngle(current()));syncPreviewLayout();return true;
  }
  function endGesture(event){
    if(!gesture||event.pointerId!==gesture.pointer)return;moveGesture(event);const saved=detachGesture();
    if(!saved.moved||saved.value===saved.angle||current()?.uid!==saved.uid){clearGhost();syncDeskewControls();scheduleLivePreview();return;}
    renderGhost(saved.value);changeAngle(saved.value,{before:saved.before,keepGhost:true});
  }
  function autoPage(){
    const p=current();if(!p||working())return;cancelDeskewGesture();clearGhost();
    const before=typeof captureEditHistory==='function'?captureEditHistory():null;delete p.deskewAngle;
    if(typeof commitEditHistory==='function')commitEditHistory(before,'자동 기울기 보정으로 전환');
    invalid=null;proInvalidate();syncProState();scheduleLivePreview();
  }
  function resetPageDeskewAngles(){
    setDeskewInteraction(false);const before=typeof captureEditHistory==='function'?captureEditHistory():null;
    for(const p of pages){delete p.deskewAngle;delete p.deskewCrop;}
    if(typeof commitEditHistory==='function')commitEditHistory(before,'페이지별 기울기 초기화');invalid=null;
  }
  function acceptDeskewPreview(uid,result){
    const p=pages.find(page=>page.uid===uid);if(!p)return;
    if(result)reports.set(uid,{key:sourceKey(p),result});
    while(reports.size>128)reports.delete(reports.keys().next().value);
    if(ghostUid===uid&&!gesture)clearGhost();syncDeskewControls();
  }
  function deskewPreviewFailed(){clearGhost();syncDeskewControls();}
  function deskewCallbacks(subset){return {deskewCache:cache,deskewKeys:subset.map(sourceKey)};}
  function validateDeskewInput(){if(invalid){$(invalid).focus();throw new RangeError('페이지 기울기는 −60°부터 +60°까지 입력하세요.');}}
  Object.assign(globalThis,{syncDeskewControls,setDeskewInteraction,cancelDeskewGesture,resetPageDeskewAngles,acceptDeskewPreview,deskewPreviewFailed,deskewCallbacks,validateDeskewInput,deskewGestureActive:()=>!!gesture});
  $('proDeskewPageMode').addEventListener('change',()=>{$('proDeskewPageMode').value==='auto'?autoPage():changeAngle(pageAngle(current()));});
  for(const id of angleInputs){
    $(id).addEventListener('input',()=>{
      const input=$(id),value=Number(input.value);
      if(input.value.trim()===''||!Number.isFinite(value)||Math.abs(value)>60){invalid=id;input.setAttribute('aria-invalid','true');$('proDeskewPageStatus').textContent='−60°부터 +60°까지 입력하세요. 마지막 유효한 각도를 유지합니다.';updateDial(pageAngle(current()));return;}
      changeAngle(value,{key:current()?.uid+':deskew-input'});
    });
    $(id).addEventListener('blur',syncDeskewControls);
    $(id).addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();invalid=null;$(id).blur();syncDeskewControls();}if(event.key==='Enter')$(id).blur();});
  }
  for(const [id,step] of [['proDeskewMinus',-.1],['proDeskewPlus',.1],['deskewDialMinus',-.1],['deskewDialPlus',.1]])$(id).addEventListener('click',()=>changeAngle(clamp(pageAngle(current())+step),{key:current()?.uid+':deskew-step'}));
  $('deskewDialReset').addEventListener('click',()=>changeAngle(0));
  $('deskewDialAuto').addEventListener('click',autoPage);
  $('deskewCropCorners').addEventListener('change',()=>{
    const p=current();if(!p||working())return;cancelDeskewGesture();clearGhost();
    const before=typeof captureEditHistory==='function'?captureEditHistory():null;
    if($('deskewCropCorners').checked)p.deskewCrop=true;else delete p.deskewCrop;
    if(typeof commitEditHistory==='function')commitEditHistory(before,'빈 모서리 자르기');
    proInvalidate();syncProState();scheduleLivePreview();
  });
  $('proDeskewResetPage').addEventListener('click',autoPage);
  $('proDeskewAdjust').addEventListener('click',()=>setDeskewInteraction(!active));
  $('compareDeskewToggle').addEventListener('click',()=>setDeskewInteraction(!active));
  $('deskewFinish').addEventListener('click',()=>{try{validateDeskewInput();}catch{return;}setDeskewInteraction(false);$('compareDeskewToggle').focus();});
  {
    const node=$('deskewDragStrip');node.addEventListener('pointerdown',beginGesture);node.addEventListener('pointermove',moveGesture);node.addEventListener('pointerup',endGesture);
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
    if(angleInputs.includes(event.target?.id))return;
    event.preventDefault();event.stopImmediatePropagation();if(cancelDeskewGesture()){syncDeskewControls();scheduleLivePreview();}else setDeskewInteraction(false);
  },true);
  $('proDeskew').addEventListener('input',()=>{invalid=null;syncDeskewControls();});
  for(const id of ['compareStage','deskewDock'])new ResizeObserver(()=>{if(gesture)cancelDeskewGesture();if(ghostUid)clearGhost();syncDeskewControls();if(typeof syncLivePreview==='function')syncLivePreview();}).observe($(id));
  $('compareAfterScroll').addEventListener('scroll',()=>{if(active&&!gesture)syncPreviewLayout();},{passive:true});
  syncDeskewControls();
})();
