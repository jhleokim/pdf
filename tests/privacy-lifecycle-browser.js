(async()=>{
 const out=document.createElement('pre');out.id='privacyLifecycle';out.style='position:fixed;inset:0;z-index:99999;background:white;color:black;padding:20px';document.body.append(out);
 const lines=[],check=(v,m)=>{if(!v)throw Error(m);lines.push('PASS '+m);out.textContent=lines.join('\n');};
 try{
  const d=await PDFDocument.create(),p=d.addPage([400,600]);p.drawText('SECRET',{x:30,y:490,size:20});p.drawText('PUBLIC',{x:30,y:40,size:20});const bytes=await d.save(),masks=[[[0,.1,1,.2]]];
  PDFPrivacyNative.dispose();const c=new AbortController();const pending=PDFPrivacyNative.run(bytes.slice(),masks,{signal:c.signal});setTimeout(()=>c.abort(),0);let aborted=false;try{await pending;}catch(e){aborted=e.name==='AbortError';}check(aborted,'Cancel during engine startup rejects the export');
  const recovered=await PDFPrivacyNative.run(bytes.slice(),masks);const task=pdfjsLib.getDocument({data:recovered.bytes.slice(),...DOC_OPTS});try{const pdf=await task.promise,text=(await(await pdf.getPage(1)).getTextContent()).items.map(t=>t.str).join('');check(text.includes('PUBLIC')&&!text.includes('SECRET'),'Immediate retry survives late initialization and actually redacts');}finally{await task.destroy();}
  await loadFiles([new File([bytes],'lifecycle.pdf',{type:'application/pdf'})]);await setProMode('basic');await new Promise(r=>setTimeout(r,200));const target=pages[0];target.annots=[{shape:'redaction',id:'mask',nx:0,ny:.1,nw:1,nh:.2}];
  const run=PDFPrivacyNative.run;let calls=0;PDFPrivacyNative.run=(...args)=>{calls++;return run(...args);};
  try{await buildEditedDocument([target]);const count=calls;const doc=await buildEditedDocument([target]);check(calls===count,'Unchanged edits reuse sanitized bytes without rerunning the engine');check(doc.getPageCount()===1,'Cached document is a fresh editable PDF');
   target.annots[0].ny=.12;await buildEditedDocument([target]);check(calls>count,'Moving a mask invalidates cached document');
   PDFPrivacy.clearCache();let release;PDFPrivacyNative.run=async(...args)=>{const result=await run(...args);await new Promise(r=>release=r);return result;};
   const stale=buildEditedDocument([target]);while(!release)await new Promise(r=>setTimeout(r,10));target.annots[0].ny=.15;release();let rejected=false;try{await stale;}catch(e){rejected=e.name==='AbortError';}check(rejected,'An edit during processing cannot cache an old result under the new mask');
  }finally{PDFPrivacyNative.run=run;}
  check(!performance.getEntriesByType('resource').some(e=>/^https?:/.test(e.name)&&new URL(e.name).origin!==location.origin),'No external document or engine requests');
  out.textContent=lines.join('\n')+'\nALL PASSED';
 }catch(e){out.textContent=lines.join('\n')+'\nFAIL '+e.stack;}
})();
