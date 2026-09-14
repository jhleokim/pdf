/* Review stamps keep their label and target independently editable. */
(()=>{
 'use strict';
 const S=PDFReviewStamp,NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg');
 svg.id='reviewStampOverlay';svg.classList.add('review-stamp-overlay');svg.setAttribute('aria-label','검토 스탬프 조절');svg.setAttribute('hidden','');
 const make=(tag,attrs={})=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);svg.append(n);return n;};
 const curve=make('path',{fill:'none','stroke-linecap':'round','stroke-linejoin':'round'}),head=make('path',{fill:'none','stroke-linecap':'round','stroke-linejoin':'round'});
 const label=make('image',{'data-review-handle':'label',role:'button',tabindex:'0','aria-label':'스탬프 위치 조절 · 드래그하거나 방향키 사용'});
 const outline=make('rect',{fill:'none',stroke:'var(--action)','stroke-dasharray':'4 3','pointer-events':'none'});
 const tip=make('circle',{'data-review-handle':'tip',fill:'transparent',role:'button',tabindex:'0','aria-label':'화살표 끝점 조절 · 드래그하거나 방향키 사용'});
 const dot=make('circle',{fill:'#fff',stroke:'var(--action)','pointer-events':'none'});
 $('compareStage').append(svg);
 const doneButton=document.createElement('button');doneButton.id='reviewStampFinish';doneButton.type='button';doneButton.className='btn review-stamp-finish';doneButton.textContent='배치 완료';doneButton.setAttribute('aria-label','스탬프 배치 확정');doneButton.hidden=true;doneButton.onclick=()=>$('stampCommit').click();$('compareStage').append(doneButton);
 let gesture=null,frame=0,renderSequence=0,pending=false,lastAsset=null;
 const before=()=>typeof captureEditHistory==='function'?captureEditHistory():null;
 const history=(state,title,key)=>{if(typeof commitEditHistory==='function')commitEditHistory(state,title,key);};
 const valid=()=>stampAsset?.review&&proMode==='pro'&&proPreviewOpen&&pages.length&&!proAbort&&!$('proCompare').hasAttribute('data-error');
 const attrs=(n,values)=>{for(const[k,v]of Object.entries(values))n.setAttribute(k,String(v));};
 function controls(){
  const r=stampAsset?.review;$('reviewStampControls').hidden=!r;$('stampEdit').hidden=!!r;
  doneButton.hidden=!valid()||!stampPositioning||$('proCompare').hidden||$('compareStage').classList.contains('show-original');doneButton.disabled=pending;
  // A review label has its own visible text field; its name follows that text.
  $('stampName').closest('label').hidden=!!r;
  for(const b of $('reviewStampPresets').querySelectorAll('button'))b.setAttribute('aria-pressed',String(r?.preset===b.dataset.preset));
  if(r&&!pending){if(document.activeElement!==$('reviewStampText'))$('reviewStampText').value=r.text;$('reviewStampColor').value=r.color;if(document.activeElement!==$('reviewStampHex'))$('reviewStampHex').value=r.color;$('reviewStampArrow').checked=r.arrow;}
  $('stampCommit').disabled=$('stampSave').disabled=$('stampPng').disabled=pending;
 }
 function paint(mark){
  const canvas=$('compareAfter'),r=canvas.getBoundingClientRect(),stage=$('compareStage').getBoundingClientRect(),size=liveOutputSize;
  if(!size||!r.width||!r.height){svg.setAttribute('hidden','');return;}
  const box=PDFStamp.placement(mark,size.width,size.height),g=S.arrow(mark,box,size.width,size.height),paths=S.path(g),scale=r.width/size.width,editable=stampPositioning;
  Object.assign(svg.style,{left:r.left-stage.left+'px',top:r.top-stage.top+'px',width:r.width+'px',height:r.height+'px'});
  svg.setAttribute('viewBox',`0 0 ${size.width} ${size.height}`);svg.removeAttribute('hidden');
  attrs(label,{href:mark.data,x:box.x,y:box.y,width:box.width,height:box.height,opacity:mark.opacity,'aria-disabled':!editable});
  attrs(outline,{x:box.x,y:box.y,width:box.width,height:box.height,'stroke-width':1/scale});outline.style.display=editable?'':'none';
  for(const [n,d]of[[curve,paths.curve],[head,paths.head]])attrs(n,{d,stroke:S.color(mark.review.color),'stroke-width':g.width,opacity:mark.opacity});
  attrs(tip,{cx:g.end.x,cy:g.end.y,r:22/scale,'aria-disabled':!editable});attrs(dot,{cx:g.end.x,cy:g.end.y,r:5/scale,'stroke-width':1.6/scale});
  tip.style.display=dot.style.display=editable&&mark.review.arrow?'':'none';
  label.style.pointerEvents=editable?'all':'none';tip.style.pointerEvents=editable?'all':'none';
  label.style.cursor=editable?'move':'default';
 }
 function syncReviewStamp(){
  controls();
  if(gesture&&(!valid()||livePage()?.uid!==gesture.uid||lastAsset!==stampAsset)){cancel();}
  lastAsset=stampAsset;
  if(!valid()||$('proCompare').hidden||$('compareStage').classList.contains('show-original')||!$('compareAfter').width){svg.setAttribute('hidden','');return;}
  let mark;try{mark=currentStamp();}catch(_){svg.setAttribute('hidden','');return;}
  if(mark.scope!=='all'&&!mark.targets.includes(livePage()?.uid)){svg.setAttribute('hidden','');return;}
  if(!gesture)paint(mark);
 }
 async function changeReview(next,{create=false}={}){
  if(stampAsset&&!stampAsset.review){toast('현재 이미지 도장을 먼저 확정하거나 배치를 취소해 주세요.');return;}
  if(gesture)cancel();const token=++renderSequence,snapshot=before(),old=stampAsset;
  pending=true;controls();$('stampStatus').textContent='스탬프 준비 중…';
  try{
   const asset=await S.render(next);if(token!==renderSequence||old!==stampAsset)return;
   stampAsset={...stampAsset,...asset};$('stampThumb').src=asset.data;$('stampName').value=asset.name;$('stampActive').hidden=false;
   if(create&&!old){$('stampScope').value='current';$('stampAnchor').value='top-left';$('stampX').value='20';$('stampY').value='20';$('stampWidth').value='50';$('stampOpacity').value='100';}
   pending=false;$('reviewStampPresets').closest('details').open=false;toolsChanged();setStampPositioning(true);history(snapshot,old?'검토 스탬프 수정':'검토 스탬프 추가',old?'review-style':null);
   $('stampStatus').textContent=pages.length?'글자 상자는 이동, 원형 손잡이는 화살표 방향 조절입니다.':'PDF를 열면 미리보기에서 배치할 수 있습니다.';
  }catch(e){if(token===renderSequence){$('stampStatus').textContent='스탬프를 만들지 못했습니다. '+e.message;}}
  finally{if(token===renderSequence){pending=false;syncReviewStamp();}}
 }
 for(const p of S.presets){const b=document.createElement('button');b.type='button';b.className='review-stamp-preset';b.dataset.preset=p.id;b.dataset.shape=p.shape;b.textContent=p.text;b.setAttribute('aria-pressed','false');b.onclick=()=>changeReview({...stampAsset?.review,preset:p.id,text:p.text,arrow:p.id!=='done'&&p.id!=='important'&&p.id!=='opinion'}, {create:true});$('reviewStampPresets').append(b);}
 $('reviewStampText').oninput=()=>changeReview({...stampAsset?.review,text:$('reviewStampText').value});
 $('reviewStampColor').oninput=()=>changeReview({...stampAsset?.review,color:$('reviewStampColor').value});
 $('reviewStampHex').oninput=()=>{const value=$('reviewStampHex').value,ok=/^#[0-9a-f]{6}$/i.test(value);$('reviewStampHex').setAttribute('aria-invalid',String(!ok));if(ok)changeReview({...stampAsset?.review,color:value});};
 $('reviewStampHex').onblur=()=>{if(stampAsset?.review){$('reviewStampHex').value=stampAsset.review.color;$('reviewStampHex').removeAttribute('aria-invalid');}};
 $('reviewStampRed').onclick=()=>changeReview({...stampAsset?.review,color:S.DEFAULT_COLOR});
 $('reviewStampArrow').onchange=()=>changeReview({...stampAsset?.review,arrow:$('reviewStampArrow').checked});
 function pagePoint(e,g){return {x:(e.clientX-g.rect.left)/g.rect.width*g.size.width,y:(e.clientY-g.rect.top)/g.rect.height*g.size.height};}
 function start(e,kind){
  if(e.button!==0||!e.isPrimary||!valid()||!stampPositioning||pending||$('proCompare').getAttribute('aria-busy')==='true')return;
  const mark=currentStamp(),size={...liveOutputSize},rect=$('compareAfter').getBoundingClientRect(),box=PDFStamp.placement(mark,size.width,size.height);
  e.preventDefault();e.stopPropagation();gesture={id:e.pointerId,uid:livePage().uid,kind,mark,size,rect,box,before:before(),start:{x:e.clientX,y:e.clientY},draft:mark,moved:false};
  const p=pagePoint(e,gesture);gesture.offset={x:p.x-box.x,y:p.y-box.y};
  if(kind==='new'){gesture.offset={x:box.width/2,y:box.height/2};gesture.moved=true;}
  lastAsset=stampAsset;svg.setPointerCapture(e.pointerId);cancelLivePreview();move(e);
 }
 function move(e){const g=gesture;if(!g||e.pointerId!==g.id)return;e.preventDefault();
  if(Math.hypot(e.clientX-g.start.x,e.clientY-g.start.y)>=3)g.moved=true;
  if(!g.moved)return;const p=pagePoint(e,g);
  if(g.kind==='tip')g.draft={...g.mark,review:{...g.mark.review,tip:S.tipAt(g.box,p.x,p.y,g.size.width,g.size.height)}};
  else{const x=Math.max(0,Math.min(g.size.width-g.box.width,p.x-g.offset.x)),y=Math.max(0,Math.min(g.size.height-g.box.height,p.y-g.offset.y));g.draft={...g.mark,anchor:'top-left',x:x*25.4/72,y:y*25.4/72};}
  if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(gesture)paint(gesture.draft);});
 }
 function detach(){const g=gesture;gesture=null;if(frame){cancelAnimationFrame(frame);frame=0;}if(g&&svg.hasPointerCapture(g.id))svg.releasePointerCapture(g.id);return g;}
 function applyDraft(mark){stampAsset={...stampAsset,review:S.normalize(mark.review)};$('stampAnchor').value=mark.anchor;$('stampX').value=mark.x.toFixed(2);$('stampY').value=mark.y.toFixed(2);toolsChanged();}
 function finish(e){if(!gesture||e.pointerId!==gesture.id)return;move(e);const g=detach();if(g.moved&&valid()&&livePage()?.uid===g.uid){applyDraft(g.draft);history(g.before,g.kind==='tip'?'스탬프 화살표 조절':'스탬프 위치 이동');}else{syncReviewStamp();scheduleLivePreview();}}
 function cancel(){if(!gesture)return false;detach();syncReviewStamp();scheduleLivePreview();return true;}
 svg.addEventListener('pointerdown',e=>{const kind=e.target.getAttribute('data-review-handle');if(kind)start(e,kind);});
 $('compareAfterScroll').addEventListener('pointerdown',e=>{if(e.target.id==='compareAfter'&&stampAsset?.review)start(e,'new');});
 svg.addEventListener('pointermove',move);svg.addEventListener('pointerup',finish);svg.addEventListener('pointercancel',cancel);svg.addEventListener('lostpointercapture',cancel);
 svg.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!cancel())setStampPositioning(false);return;}
  const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!d||!valid()||!stampPositioning||pending)return;
  e.preventDefault();e.stopPropagation();const mark=currentStamp(),box=PDFStamp.placement(mark,liveOutputSize.width,liveOutputSize.height),step=e.shiftKey?10:1,snapshot=before();
  if(e.target===tip){const end=S.arrow(mark,box,liveOutputSize.width,liveOutputSize.height).end;mark.review={...mark.review,tip:S.tipAt(box,end.x+d[0]*step,end.y+d[1]*step,liveOutputSize.width,liveOutputSize.height)};}
  else{mark.anchor='top-left';mark.x=Math.max(0,Math.min(liveOutputSize.width-box.width,box.x+d[0]*step))*25.4/72;mark.y=Math.max(0,Math.min(liveOutputSize.height-box.height,box.y+d[1]*step))*25.4/72;}
  applyDraft(mark);history(snapshot,'검토 스탬프 조절','review-keyboard');
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&gesture){e.preventDefault();e.stopPropagation();cancel();}},true);
 $('compareAfterScroll').addEventListener('scroll',()=>{cancel();syncReviewStamp();});
 new ResizeObserver(()=>{cancel();syncReviewStamp();}).observe($('compareStage'));
 // Existing stamp actions keep their library/export behavior. Include editable
 // review metadata, rather than flattening the arrow into a saved thumbnail.
 const oldSave=$('stampSave').onclick;$('stampSave').onclick=()=>{if(!stampAsset?.review)return oldSave();try{if(stampShelf.length>=8)throw Error('보관함은 최대 8개입니다.');const next=[...stampShelf,{...stampAsset,review:S.normalize(stampAsset.review)}];localStorage.setItem('pdfstudio-stamps-v1',JSON.stringify(next));stampShelf=next;renderStampShelf();$('stampStatus').textContent='색상과 화살표를 함께 보관했습니다.';}catch(e){toast(e.message,true);}};
 const oldPng=$('stampPng').onclick;$('stampPng').onclick=async()=>{if(!stampAsset?.review)return oldPng();try{toolDownload(await S.png(currentStamp()),(stampAsset.name||'검토 스탬프')+'.png','image/png');}catch(e){toast(e.message,true);}};
 for(const id of ['stampClear','stampCommit']){const action=$(id).onclick;$(id).onclick=()=>{if(pending&&id==='stampCommit')return;const snapshot=before();++renderSequence;pending=false;cancel();action();history(snapshot,id==='stampCommit'?'도장 배치 확정':'도장 배치 취소');syncReviewStamp();};}
 globalThis.syncReviewStamp=syncReviewStamp;globalThis.cancelReviewStampGesture=cancel;globalThis.reviewStampPending=()=>pending;
 const clone=m=>m?{...m,targets:m.targets?.slice(),...(m.review?{review:S.normalize(m.review)}:{})}:null;
 const hashes=new WeakMap();function stampSignature(m){if(!m)return null;if(!hashes.has(m)){let a=2166136261,b=5381;for(const s of [m.data||'',m.sourceData||''])for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i);}hashes.set(m,[a>>>0,b>>>0,(m.data||'').length]);}const{data,sourceData,...rest}=m;return {...rest,image:hashes.get(m)};}
 globalThis.captureStampHistory=()=>{const fields=Object.fromEntries([...stampControlIds,'stampName'].map(id=>[id,$(id).value]));return {asset:clone(stampAsset),marks:stampMarks.map(clone),editing:stampEditing?{...stampEditing,mark:clone(stampEditing.mark)}:null,fields,signature:JSON.stringify([stampSignature(stampAsset),stampMarks.map(stampSignature),stampEditing?{index:stampEditing.index,mark:stampSignature(stampEditing.mark)}:null,fields])};};
 globalThis.restoreStampHistory=state=>{++renderSequence;pending=false;cancel();stampAsset=clone(state.asset);stampMarks=state.marks.map(clone);stampEditing=state.editing?{...state.editing,mark:clone(state.editing.mark)}:null;for(const[id,value]of Object.entries(state.fields))$(id).value=value;$('stampActive').hidden=!stampAsset;if(stampAsset)$('stampThumb').src=stampAsset.data;renderStampMarks();toolsChanged();setStampPositioning(!!stampAsset?.review);};
 syncReviewStamp();
})();
