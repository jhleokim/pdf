/* Local harness only: no OCR/network service. Source sample is served on loopback. */
(async()=>{
 const box=document.createElement('pre');box.id='compressionQA';box.style='position:fixed;bottom:0;left:0;max-height:35vh;overflow:auto;background:white;color:black;z-index:99999;padding:12px;font:12px monospace';document.body.append(box);
 const results=[],check=(ok,name,detail)=>{if(!ok)throw Error(name+' '+JSON.stringify(detail));results.push({name,...detail});box.textContent=JSON.stringify(results,null,2);};
 const save=async(name,bytes)=>{if(!self.COMPRESSION_OFFLINE){const r=await fetch('/qa/'+name,{method:'POST',body:bytes});if(!r.ok)throw Error('Local QA output failed');}};
 const wait=async(fn)=>{for(let i=0;i<600;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('UI did not settle');};
 async function texts(bytes){const task=pdfjsLib.getDocument({data:bytes.slice(),...DOC_OPTS});try{const d=await task.promise,a=[];for(let i=1;i<=d.numPages;i++)a.push((await(await d.getPage(i)).getTextContent()).items.map(t=>t.str).join(''));return a;}finally{await task.destroy();}}
 const P=PDFLib,N=P.PDFName.of;
 const images=d=>d.context.enumerateIndirectObjects().filter(([,v])=>v instanceof P.PDFRawStream&&String(v.dict.get(N('Subtype')))==='/Image');
 const defaults={optimize:true,maxDimension:2400,jpegQuality:.82,adaptiveResolution:true};
 try{
  if(!self.COMPRESSION_OFFLINE){
   const original=new Uint8Array(await(await fetch('/work/compression-qa/contract.pdf')).arrayBuffer());
   for(const [name,engine,options]of [['old-balanced.pdf',PDFProBaseline,{...defaults,adaptiveResolution:false}],['new-balanced.pdf',PDFPro,defaults],['target.pdf',PDFPro,{...defaults,targetBytes:800000}],['small.pdf',PDFPro,{...defaults,maxDimension:1200,jpegQuality:.5}]]){
    const doc=await P.PDFDocument.load(original),start=performance.now(),report=await engine.processDocument(doc,options),output=await doc.save();
    check((await texts(output)).length===6,name,{input:original.length,output:output.length,seconds:+((performance.now()-start)/1000).toFixed(2),changed:report.changed,attempts:report.attempts,placements:report.placementResized,notes:report.notes,images:images(doc).map(([,s])=>({w:String(s.dict.get(N('Width'))),h:String(s.dict.get(N('Height'))),bytes:s.getContents().length}))});await save(name,output);
   }
  }
  const source=await P.PDFDocument.create(),canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1600;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#d8ecec';ctx.fillRect(0,0,2400,1600);ctx.fillStyle='#007f76';
  for(let y=50;y<1600;y+=70){ctx.font='32px Arial';ctx.fillText('DOCUMENT 2026 - AMOUNT 12,345.00',40,y);}
  const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.98)),jpeg=new Uint8Array(await blob.arrayBuffer()),im=await source.embedJpg(jpeg);
  source.addPage([600,800]).drawImage(im,{x:30,y:550,width:144,height:96});
  source.getPage(0).drawText('PUBLIC SECRET PUBLIC',{x:30,y:450,size:16});
  source.getPage(0).drawText('INVISIBLE OCR 12345',{x:30,y:690,size:12,opacity:0});
  source.addPage([600,800]).drawImage(im,{x:30,y:500,width:300,height:200});
  // A separately embedded duplicate must be decoded once and still serve both pages.
  const dup=await source.embedJpg(jpeg);source.addPage([600,800]).drawImage(dup,{x:30,y:500,width:60,height:40});
  const original=await source.save(),baseline=await P.PDFDocument.load(original),smart=await P.PDFDocument.load(original);
  let oldBytes;
  if(!self.COMPRESSION_OFFLINE){await PDFProBaseline.processDocument(baseline,defaults);oldBytes=(await baseline.save()).length;}
  const start=performance.now(),report=await PDFPro.processDocument(smart,defaults),output=await smart.save(),image=images(smart)[0][1];
  check(report.duplicates===1&&report.processed===1,'duplicates decoded once',{duplicates:report.duplicates,processed:report.processed});
  const width=Number(String(image.dict.get(N('Width'))));check(width>=854&&width<=856,'largest shared placement sets resolution',{width});
  check(JSON.stringify(await texts(original))===JSON.stringify(await texts(output)),'visible and invisible text preserved');
  check(!oldBytes||output.length<oldBytes*.8,'placed image savings',{input:original.length,oldOutput:oldBytes,output:output.length,seconds:+((performance.now()-start)/1000).toFixed(2)});
  await save('searchable.pdf',output);
  // Placement startup/queue remains cancellable, including a worker just loaded.
  const ac=new AbortController(),pending=PDFPrivacyNative.placements(original.slice(),{signal:ac.signal});ac.abort();
  await pending.then(()=>{throw Error('Cancellation ignored');},e=>check(e.name==='AbortError','placement cancellation'));
  await loadFiles([new File([original],'compression-test.pdf',{type:'application/pdf'})]);await setProMode('pro');cancelLivePreview();
  $('proOptimize').checked=true;$('proTargetMB').value='0.1';$('proResolution').value='2400';$('proQuality').value='82';refreshProControls();proInvalidate();
  scheduleLivePreview();await wait(()=>!$('proCompare').hasAttribute('data-error')&&$('compareState').textContent.startsWith('예상 미리보기'));
  check($('compareState').textContent.includes('목표 용량'),'preview identifies estimate before export');
  const run=createProResult({reveal:false});await wait(()=>!!proResult||$('documentCheckDialog').open||!proAbort);
  if($('documentCheckDialog').open){$('documentCheckAccept').checked=true;$('documentCheckAccept').dispatchEvent(new Event('change'));$('documentCheckContinue').click();}
  const result=await run;check(!!result?.bytes,'UI target export',{status:$('proStatus').textContent});
  await wait(()=>$('compareState').textContent==='저장 결과 미리보기'||$('proCompare').hasAttribute('data-error'));
  check(!$('proCompare').hasAttribute('data-error')&&liveCache.savedTarget,'preview renders saved result',{state:$('compareState').textContent});
  $('compareNext').click();await wait(()=>$('comparePageLabel').textContent.startsWith('2 /')&&$('compareState').textContent==='저장 결과 미리보기');
  check(!$('proCompare').hasAttribute('data-error'),'saved result next page');
  // Regional redaction + compression preserves surrounding text and hidden OCR.
  cancelLivePreview();pages[0].annots=[{id:'mask-test',shape:'redaction',nx:.16,ny:.414,nw:.11,nh:.032,fill:'#000000',stroke:'none',opacity:1,lineWidth:0}];
  $('proTargetMB').value='';proInvalidate();refreshProControls();
  const masking=createProResult({reveal:false});await wait(()=>$('documentCheckDialog').open||!!proResult||!proAbort);
  if($('documentCheckDialog').open){$('documentCheckAccept').checked=true;$('documentCheckAccept').dispatchEvent(new Event('change'));$('documentCheckContinue').click();}
  const masked=await masking;check(!!masked?.bytes,'mask and compress export',{status:$('proStatus').textContent});
  const all=(await texts(masked.bytes)).join('');check(!all.includes('SECRET')&&all.includes('PUBLIC')&&all.includes('INVISIBLE OCR'),'redaction removes only private text',{characters:all.length});
  await save('masked.pdf',masked.bytes);
  await save('metrics.json',JSON.stringify(results,null,2));box.textContent=JSON.stringify(results,null,2)+'\nALL PASSED';document.body.dataset.compressionQA='passed';
  parent.postMessage({compressionQA:box.textContent},'*');
 }catch(e){box.textContent=JSON.stringify(results,null,2)+'\nFAIL '+e.stack;document.body.dataset.compressionQA='failed';parent.postMessage({compressionQA:box.textContent},'*');}
})();
