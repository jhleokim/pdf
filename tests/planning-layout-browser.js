/* CSS breakpoint and interactive workspace integration, without cloud requests. */
(async()=>{
 const out=document.createElement('pre');out.id='layoutChecks';out.style='font:12px monospace;position:fixed;bottom:0;left:0;background:white;color:black;z-index:99999;pointer-events:none';document.body.append(out);
 const lines=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(v,label)=>{if(!v)throw Error(label);lines.push('PASS '+label);out.textContent=lines.join('\n');};
 const visible=id=>!!$(id).getClientRects().length&&getComputedStyle($(id)).display!=='none';
 try{
  await setProMode('basic');const d=await PDFDocument.create();d.addPage([400,600]).drawText('PORTRAIT',{x:30,y:500});d.addPage([600,400]).drawText('LANDSCAPE',{x:30,y:300});await loadFiles([new File([await d.save()],'Mixed layout.pdf',{type:'application/pdf'})]);
  await setProMode('pro');await wait(500);
  if(isCompactPro()){
   for(const [view,only]of [['pages','boardWrap'],['settings','proPanel'],['workspace','proCompare']]){
    setProView(view);await wait(120);check(['boardWrap','proPanel','proCompare'].every(id=>visible(id)===(id===only)),view+' shows one dedicated workspace');
   }
   check(['proPages','proWorkspace','proSettings','btnBlank'].every(id=>{const r=$(id).getBoundingClientRect();return r.height>=44&&r.width>=44;}),'Main touch targets are at least 44px');
   for(let i=0;i<200&&($('compareAfter').width===0||$('proCompare').getAttribute('aria-busy')==='true');i++)await wait(30);
   check($('compareAfter').width>0&&!$('proCompare').dataset.error,'Actual page preview renders at small viewport');
   const before=liveSequence;setProView('settings');await wait(100);const paused=liveSequence;$('proNumber').checked=true;$('proNumber').dispatchEvent(new Event('input'));await wait(400);
   check(liveSequence===paused&&paused>=before,'Hidden preview does not process each settings change');
   $('proPreview').click();await wait(150);check(document.body.dataset.proView==='workspace'&&visible('proCompare'),'Settings preview button returns to preview');
   $('compareClose').click();check(document.body.dataset.proView==='pages'&&visible('boardWrap'),'Closing preview returns to pages');
  }else{
   setProView('settings');await wait(150);check(visible('proCompare')&&visible('proPanel')&&visible('boardWrap'),'Wide screen retains preview, settings and page list together');check(!visible('proPages'),'Extra compact page tab is hidden on wide screen');
  }
  check(document.documentElement.scrollWidth<=innerWidth,'No document-level horizontal overflow');
  const picked=pages[0];setProView(isCompactPro()?'pages':'workspace');select(0,{});$('pageOrderButton').click();await wait(50);check(pageOrderDialog.open&&$('pageOrderPosition').getBoundingClientRect().width>0,'Reorder dialog and position input remain available');pageOrderDialog.close();
  check(visible('documentUndo')&&visible('documentRedo'),'Undo and redo are visible with the page list');
  out.textContent='ALL PASSED '+innerWidth+'×'+innerHeight+'\n'+lines.join('\n');
 }catch(e){out.textContent='FAIL '+innerWidth+'×'+innerHeight+' '+e.stack;console.error(e);}
 if(parent!==self)parent.postMessage({layoutQA:out.textContent},'*');
})();
