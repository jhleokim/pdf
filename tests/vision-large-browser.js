/* Actual page rendering + client workflow; Vision responses are local fixtures. */
(async()=>{
 const out=document.createElement('pre');out.id='visionLargeQA';out.style='position:fixed;bottom:0;left:0;z-index:99999;background:white;color:black;padding:10px;max-height:30vh;overflow:auto';document.body.append(out);
 const lines=[],assert=(ok,text)=>{if(!ok)throw Error(text);lines.push('PASS '+text);out.textContent=lines.join('\n');};
 const originalFetch=fetch,originalBuild=buildEditedDocument;let posts=0,ordinal=1,builds=0,lastBody='',maxUpload=0;const retried=new Set();
 try{
  out.textContent='Loading local PDF; cloud calls are mocked.';
  const bytes=new Uint8Array(await(await originalFetch('/qa/book.pdf')).arrayBuffer());
  await loadFiles([new File([bytes],'large-scan.pdf',{type:'application/pdf'})]);
  setLivePreviewOpen(false);displayProMode('pro');setLivePreviewOpen(false);
  for(const id of proControlIds){const e=$(id);if(e.type==='checkbox')e.checked=false;}
  $('proContrast').value=0;$('proWhitePoint').value=255;$('proPaper').value='original';$('ocrProvider').value='vision';refreshProControls();
  assert(pages.length===212,'Loaded 212-page local fixture');
  buildEditedDocument=(...args)=>{builds++;return originalBuild(...args);};
  fetch=async(url,init)=>{
   if(!String(url).endsWith('/api/ocr/vision'))return originalFetch(url,init);
   posts++;const body=JSON.parse(init.body);maxUpload=Math.max(maxUpload,body.image.length);const n=ordinal;
   if([60,140].includes(n)&&!retried.has(n)){
    retried.add(n);lastBody=init.body;out.textContent=lines.join('\n')+'\nInjecting retryable failure on '+n;
    return Response.json({error:'Local quota fixture',code:'VISION_RATE_LIMIT',retryAfter:1},{status:429});
   }
   if(lastBody){assert(lastBody===init.body,'Retry keeps identical image for page '+n);lastBody='';}
   ordinal++;out.textContent=lines.join('\n')+'\nRendered page '+n+' / '+pages.length+'; '+posts+' mocked requests';
   return Response.json({text:'PAGE '+n,words:[{text:'PAGE '+n,box:[.1,.1,.4,.15],separator:'\n',confidence:99}]});
  };
  const started=performance.now();await runOCR(false,'vision',[...pages],true);const seconds=(performance.now()-started)/1000;
  assert(ocrRecords.length===212,'All 212 results visible after failures at 60 and 140');
  assert(ocrRecords.every((r,i)=>r.page===i+1&&r.text==='PAGE '+(i+1)),'Page mapping retained without missing or repeated results');
  assert(posts===214,'Only failed requests retried (214 requests / 212 pages)');
  assert(builds===0,'Unedited scans never reopen the complete PDF in pdf-lib');
  assert(maxUpload<=8*1024*1024,'Every prepared upload remains inside the client/server size cap');
  const count=posts;await runOCR(false,'vision',[...pages],true);assert(posts===count,'Completed pages reused without another request');
  // Surface completed pages even when a later page has a permanent failure.
  resetTools();let call=0;fetch=async()=>++call===3?Response.json({code:'VISION_IMAGE',error:'Local invalid-image fixture'},{status:400}):Response.json({text:'PARTIAL '+call,words:[{text:'PARTIAL '+call,box:[.1,.1,.4,.15],separator:'\n',confidence:99}]});
  await runOCR(false,'vision',pages.slice(0,4),true);
  assert(call===3&&ocrRecords.length===2,'Permanent page failure preserves the two completed results in the UI');
  assert($('ocrStatus').textContent.includes('3쪽')&&$('ocrStatus').textContent.includes('VISION_IMAGE'),'Failure reports the page and error code');
  out.textContent=lines.join('\n')+'\nALL PASSED · '+seconds.toFixed(2)+'s rendering/encoding with mocked OCR · max base64 '+maxUpload+' bytes';
 }catch(e){out.textContent=lines.join('\n')+'\nFAIL '+e.stack;console.error(e);}
 finally{fetch=originalFetch;buildEditedDocument=originalBuild;}
})();
