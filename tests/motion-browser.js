(async()=>{
 const out=$('motionChecks'),checks=[],failures=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),frame=()=>new Promise(requestAnimationFrame);
 const assert=(v,m)=>{if(!v)throw Error(m)},report=()=>{out.textContent=checks.concat(failures).join('\n')};
 const test=async(name,fn)=>{try{await fn();checks.push('PASS '+name)}catch(e){failures.push('FAIL '+name+': '+e.message)}report()};
 const motion=el=>el.getAnimations().filter(a=>a.effect.getKeyframes().some(k=>'transform' in k));
 const order=()=>pages.map(p=>p.uid).join(',');
 const settle=async()=>{marker.remove();for(const p of pages)for(const a of motion(p.el))a.finish();await frame()};
 try{
  await setupMotionDocument();await frame();
  await test('Interrupted card movement stays continuous with one animation per card',async()=>{
   let before=captureBoardPositions();board.insertBefore(marker,pages[0].el);animateBoardFrom(before);await wait(50);
   before=captureBoardPositions();board.appendChild(marker);animateBoardFrom(before);
   const active=Math.max(...pages.map(p=>motion(p.el).length));
   const jump=Math.max(...pages.map(p=>{const a=before.get(p.uid),b=p.el.getBoundingClientRect();return Math.hypot(a.left-b.left,a.top-b.top)}));
   assert(active<=1,'overlapping animations: '+active);assert(jump<2,'retarget jump: '+jump.toFixed(1)+'px');await settle();
  });await settle();
  await test('Frame-by-frame retargeting settles without stacked or stranded motion',async()=>{
   for(let i=0;i<18;i++){
    await frame();const before=captureBoardPositions();board.insertBefore(marker,pages[i%2?1:3].el);animateBoardFrom(before);
    for(const p of pages){const a=before.get(p.uid),b=p.el.getBoundingClientRect();assert(motion(p.el).length<=1,'stacked movement');assert(Math.hypot(a.left-b.left,a.top-b.top)<2,'visible jump while retargeting')}
   }
   await wait(300);assert(pages.every(p=>motion(p.el).length===0),'movement did not settle');await settle();
  });await settle();
  await test('Desktop reorder animates and commits at the displayed marker',async()=>{
   const data=new DataTransfer(),card=pages[0].el,target=pages[2].el.getBoundingClientRect();
   card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
   board.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data,clientX:target.left+4,clientY:target.top+12}));
   const animated=pages.some(p=>motion(p.el).length>0);
   const moved=pages[0].uid,anchor=marker.nextElementSibling?.dataset.uid,expected=pages.slice(1).map(p=>p.uid),at=anchor?expected.indexOf(anchor):expected.length;expected.splice(at<0?expected.length:at,0,moved);
   board.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
   assert(animated,'cards snap to the new grid positions');assert(order()===expected.join(','),'drop does not match the marker');assert(!marker.parentNode,'drag marker remains');await settle();
  });await settle();
  await test('Touch cancellation restores the original order and removes the ghost',async()=>{
   const original=order(),card=pages[0].el,r=card.getBoundingClientRect();
   card.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:71,isPrimary:true,clientX:r.left+20,clientY:r.top+20}));
   startTouchDrag();board.insertBefore(marker,pages[3].el);
   document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:71,pointerType:'touch'}));
   assert(order()===original,'cancel moved pages');assert(!tdrag&&!$('ghost')&&!marker.parentNode,'drag resources remain');
  });await settle();
  await test('Dropping a touch drag outside the board leaves the order intact',async()=>{
   const original=order(),card=pages[0].el,r=card.getBoundingClientRect();
   card.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:72,isPrimary:true,clientX:r.left+20,clientY:r.top+20}));
   startTouchDrag();board.insertBefore(marker,pages[3].el);placeMarker(1,1);
   document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:72,pointerType:'touch'}));
   assert(order()===original,'outside drop moved pages');assert(!tdrag&&!$('ghost')&&!marker.parentNode,'drag resources remain');
  });await settle();
  await test('Blank drag cancellation closes the gap without adding a page',async()=>{
   const original=order(),button=isMobile()?$('mbBlank'):$('btnBlank'),r=button.getBoundingClientRect(),target=pages[1].el.getBoundingClientRect();
   button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:73,isPrimary:true,button:0,clientX:r.left+4,clientY:r.top+4}));
   document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:73,clientX:target.left+4,clientY:target.top+12}));
   await wait(60);const before=captureBoardPositions();document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:73}));
   assert(order()===original&&!blankPointer&&!document.querySelector('.blank-page-ghost')&&!marker.parentNode,'cancel left a page or drag state');
   const jump=Math.max(...pages.map(p=>{const a=before.get(p.uid),b=p.el.getBoundingClientRect();return Math.hypot(a.left-b.left,a.top-b.top)}));
   assert(jump<2,'gap closes abruptly: '+jump.toFixed(1)+'px');await settle();
  });await settle();
  await test('Rapid zoom and editing transitions leave the latest page aligned',async()=>{
   if(isMobile())setMobileView('preview');
   if(!isMobile()){await setEditingFocus(true);await setEditingFocus(false);await setEditingFocus(true)}
   setZoom(1.1);setZoom(1.4);setZoom(1.8);await showPreview(pages[1]);
   assert(previewUid===pages[1].uid&&$('pvZoomVal').textContent==='180%','stale zoom or page');
   const c=$('pvCanvas').getBoundingClientRect(),o=$('pvOverlay').getBoundingClientRect();
   assert(c.width>0&&Math.abs(c.width-o.width)<1&&Math.abs(c.height-o.height)<1,'overlay and page diverge');
   if(!isMobile())await setEditingFocus(false);if(isMobile())setMobileView('board');
  });await settle();
  await test('Reduced motion skips movement while keeping insertion usable',async()=>{
   const original=window.matchMedia;window.matchMedia=q=>q.includes('prefers-reduced-motion')?{matches:true}:original.call(window,q);
   try{const before=captureBoardPositions();board.insertBefore(marker,pages[1].el);animateBoardFrom(before);assert(pages.every(p=>motion(p.el).length===0),'motion still runs');assert(marker.parentNode===board,'insertion marker missing')}finally{window.matchMedia=original;await settle()}
  });
 }catch(e){failures.push('FAIL setup: '+e.stack)}
 out.textContent=(failures.length?'FAIL':'PASS')+' · '+checks.length+'/'+(checks.length+failures.length)+' motion checks\n'+checks.concat(failures).join('\n');
 if(parent!==window)parent.postMessage({motionReport:out.textContent},location.origin);
})();
