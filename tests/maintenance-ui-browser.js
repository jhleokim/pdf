(async()=>{
 const out=document.createElement('pre');out.id='maintenanceChecks';out.style='position:fixed;bottom:0;left:0;background:white;color:black;z-index:100001;max-height:20vh;overflow:auto;font:11px monospace';document.body.append(out);
 const checks=[],failures=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg);};
 const test=async(name,fn)=>{try{await fn();checks.push(name);}catch(e){failures.push(name+': '+e.message);}out.textContent=checks.concat(failures).join('\n');};
 try{
  await setProMode('basic');await insertBlankPage();await openBasicSaveDialog();await wait(200);
  const button=$('basicSaveDialog').querySelector('.help-dot'),tooltip=$('contextHelp');
  await test('Keyboard help remains inside the active modal accessibility tree',async()=>{
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));button.focus();
   assert(!tooltip.hidden&&tooltip.textContent.includes('다운로드'),'Help did not open');
   assert($('basicSaveDialog').contains(tooltip),'Help is outside the modal top layer and is inert/covered');
   const r=tooltip.getBoundingClientRect();assert(r.width>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1,'Tooltip clipped by viewport');
  });
  await test('Touch hold help appears and release dismisses it',async()=>{
   button.blur();button.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',bubbles:true,clientX:20,clientY:20}));await wait(380);
   assert(!tooltip.hidden,'Touch help did not open');button.dispatchEvent(new PointerEvent('pointerup',{pointerType:'touch',bubbles:true}));assert(tooltip.hidden,'Touch release left help visible');
  });
  await test('Mouse help waits a full second and hides on exit',async()=>{
   button.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));await wait(600);assert(tooltip.hidden,'Help appeared too early');await wait(500);assert(!tooltip.hidden,'Hover help missing');button.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));assert(tooltip.hidden,'Mouse exit left help visible');
  });
  await test('Closing a modal clears stale help and its accessibility reference',async()=>{
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));button.focus();closeBasicSaveDialog();await wait(20);assert(tooltip.hidden&&!button.hasAttribute('aria-describedby'),'Closed modal leaves active help');
  });
  const cancel=$('busyCancel'),prior={onclick:cancel.onclick,hidden:cancel.hidden,disabled:cancel.disabled};let cancelled=0;
  try{
   busy(true,'검사 중');cancel.hidden=false;cancel.disabled=false;cancel.onclick=()=>cancelled++;
   await test('Keyboard Tab reaches the cancel action while work is running',async()=>{const e=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});document.dispatchEvent(e);assert(document.activeElement===cancel,'Busy keyboard trap prevents reaching Cancel');});
   await test('Keyboard activation and Escape can cancel without editing pages',async()=>{
    const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});cancel.dispatchEvent(enter);assert(!enter.defaultPrevented,'Native keyboard activation of Cancel is blocked');
    const esc=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});document.dispatchEvent(esc);assert(cancelled===1,'Escape did not cancel');const count=pages.length;document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));assert(pages.length===count,'Processing allowed page deletion');
   });
  }finally{busy(false);Object.assign(cancel,prior);}
 }catch(e){failures.push(e.stack);}
 out.textContent=(failures.length?'FAIL':'PASS')+' · '+checks.length+' / '+(checks.length+failures.length)+' maintenance UI checks\n'+checks.map(s=>'PASS '+s).concat(failures.map(s=>'FAIL '+s)).join('\n');
 if(parent!==window)parent.postMessage({maintenanceReport:out.textContent},location.origin);
})();
