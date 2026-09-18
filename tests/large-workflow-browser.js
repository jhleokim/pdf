/* Synthetic documents stay in this tab. Cloud responses are fixtures, never API calls. */
(async()=>{
 const output=document.createElement('pre');output.id='largeWorkflowChecks';output.style='position:fixed;bottom:0;left:0;z-index:99999;background:#fff;color:#111;padding:10px;max-height:28vh;max-width:95vw;overflow:auto;font:11px monospace';document.body.append(output);
 const query=new URLSearchParams(location.search),scan=query.get('kind')==='scan',count=Number(query.get('count')||(scan?212:1000));
 const report={kind:scan?'scan':'text',count,phases:[],checks:[]},assert=(ok,m)=>{if(!ok)throw Error(m);report.checks.push(m);},show=label=>{output.textContent=(label||'RUNNING')+'\n'+JSON.stringify(report,null,2);};
 let phase='',maxLag=0,last=performance.now(),longest=0;const ticker=setInterval(()=>{const now=performance.now();maxLag=Math.max(maxLag,now-last-50);last=now;},50);
 let observer;try{observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longest=Math.max(longest,e.duration);});observer.observe({entryTypes:['longtask']});}catch(_){}
 async function measure(name,fn){phase=name;show(name);await idle();maxLag=0;longest=0;last=performance.now();const start=performance.now();const value=await fn();await idle();report.phases.push({name,seconds:+((performance.now()-start)/1000).toFixed(2),maxMainThreadGapMs:Math.round(maxLag),longestTaskMs:Math.round(longest),heapMiB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null});show(name+' done');return value;}
 const originalFetch=fetch;
 try{
  await setProMode('basic');setLivePreviewOpen(false);
  let bytes=await measure('generate fixture',async()=>{
   const doc=await PDFLib.PDFDocument.create(),canvas=document.createElement('canvas');canvas.width=840;canvas.height=1188;const ctx=canvas.getContext('2d');let random=73;
   for(let i=0;i<count;i++){
    const p=doc.addPage([595.28,841.89]);
    if(scan){const pixels=ctx.createImageData(canvas.width,canvas.height);for(let j=0;j<pixels.data.length;j+=4){random=(Math.imul(random,1664525)+1013904223)>>>0;const n=180+(random>>>24)%76;pixels.data[j]=n;pixels.data[j+1]=n;pixels.data[j+2]=n;pixels.data[j+3]=255;}ctx.putImageData(pixels,0,0);ctx.fillStyle='#111';ctx.font='24px sans-serif';ctx.fillText('CONTRACT PAGE '+(i+1),45,65);ctx.font='16px sans-serif';for(let row=0;row<40;row++)ctx.fillText('Synthetic document review 2026 / section '+row+' / amount 123,456',45,100+row*24);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.82));const img=await doc.embedJpg(await blob.arrayBuffer());p.drawImage(img,{x:0,y:0,width:595.28,height:841.89});}
    p.drawText('PAGE-'+(i+1),{x:30,y:20,size:12});
    if(i%5===0){show('Generating '+(i+1)+' / '+count);await idle();}
   }
   canvas.width=canvas.height=0;return doc.save({useObjectStreams:true});
  });report.inputMiB=+(bytes.length/1048576).toFixed(2);
  await measure('import',()=>loadFiles([new File([bytes],'synthetic-'+count+'.pdf',{type:'application/pdf'})]));bytes=null;assert(pages.length===count,'All pages imported');
  await measure('navigate 20 distant pages',async()=>{for(let i=0;i<20;i++){const p=pages[Math.round(i*(count-1)/19)];p.el.scrollIntoView({block:'center'});await showPreview(p);await new Promise(r=>setTimeout(r,60));}});
  const cached=pages.filter(p=>p.canvas);report.thumbnailCanvases=cached.length;report.thumbnailPixels=cached.reduce((n,p)=>n+p.canvas.width*p.canvas.height,0);assert(cached.length<=24+thumbVisible.size,'Thumbnail raster cache stays bounded');
  await measure('rotate all and undo',async()=>{selectAll();rotate(pages,90);await requestEditUndo();});assert(pages.every(p=>p.rotation===0),'Undo restores all page orientations');
  const pick=[0,Math.floor(count/2),count-1];pages.forEach((p,i)=>p.el.classList.toggle('selected',pick.includes(i)));syncCounts();
  await measure('save selected three pages',()=>openBasicSaveDialog({scope:'selected'}));assert(basicSaveState?.phase==='ready','Selected save completed');
  let pdf=await PDFLib.PDFDocument.load(basicSaveState.bytes);assert(pdf.getPageCount()===3,'Selected export has exactly three pages');pdf=null;report.selectedMiB=+(basicSaveState.bytes.length/1048576).toFixed(2);closeBasicSaveDialog();
  await measure('save complete Basic document',()=>openBasicSaveDialog());assert(basicSaveState.phase==='ready','Full Basic save completed');report.basicOutputMiB=+(basicSaveState.bytes.length/1048576).toFixed(2);closeBasicSaveDialog();
  if(scan){
   await setProMode('pro');setLivePreviewOpen(false);let requests=0,builds=0,ordinal=0;const originalBuild=buildEditedDocument;
   buildEditedDocument=(...args)=>{builds++;return originalBuild(...args);};
   fetch=async(url,init)=>{if(!String(url).endsWith('/api/ocr/vision'))return originalFetch(url,init);requests++;ordinal++;return Response.json({text:'RECOGNIZED-'+ordinal,words:[{text:'RECOGNIZED-'+ordinal,box:[.1,.1,.6,.13],separator:'\n',confidence:99}]});};
   await measure('Vision client 212-page local rendering (mock responses)',()=>runOCR(false,'vision',[...pages],true));
   assert(ocrRecords.length===count,'OCR client completes every page');assert(requests===count&&builds===0,'OCR unedited scans avoid full PDF rebuilds');
   const previous=requests;await measure('reuse completed OCR',()=>runOCR(false,'vision',[...pages],true));assert(requests===previous,'Completed OCR pages are reused');
   fetch=originalFetch;buildEditedDocument=originalBuild;$('ocrAccept').click();
   await measure('save complete Pro document with OCR',()=>openBasicSaveDialog());assert(basicSaveState.phase==='ready','Full Pro OCR save completed');report.proOutputMiB=+(basicSaveState.bytes.length/1048576).toFixed(2);closeBasicSaveDialog();
  }
  assert(!performance.getEntriesByType('resource').some(r=>/^https?:/.test(r.name)&&new URL(r.name).origin!==location.origin),'No external document or OCR service request');show('PASS');
 }catch(e){report.error=phase+': '+e.stack;show('FAIL');console.error(e);}finally{clearInterval(ticker);observer?.disconnect();fetch=originalFetch;}
})();
