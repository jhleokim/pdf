(async()=>{
 const report=document.createElement('pre');report.id='privacySizeChecks';report.style='position:fixed;bottom:0;left:0;max-height:40vh;overflow:auto;z-index:99999;background:white;color:black;padding:12px;font:12px monospace';document.body.append(report);
 const results=[],show=()=>{report.textContent=JSON.stringify(results,null,2);},sleep=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  const bytes=Uint8Array.from(atob('TEST_PDF_BASE64'),c=>c.charCodeAt(0));await loadFiles([new File([bytes],'local-contract.pdf',{type:'application/pdf'})]);await setProMode('pro');
  const masks=[[.22,.23,.14,.105],[.065,.515,.30,.137]];pages[0].annots=masks.map(([nx,ny,nw,nh],i)=>({id:'size-mask-'+i,shape:'redaction',nx,ny,nw,nh,fill:'#000000',stroke:'none',opacity:1,lineWidth:0}));
  $('proOptimize').checked=true;$('proDeskew').checked=false;refreshProControls();
  for(const [label,quality,dimension] of [['balanced',82,2400],['small',50,1200]]){
   $('proQuality').value=quality;$('proResolution').value=dimension;proInvalidate();refreshProControls();
   const start=performance.now(),pending=createProResult({reveal:false});for(let n=0;n<300&&!$('documentCheckDialog').open;n++)await sleep(20);
   if($('documentCheckDialog').open){$('documentCheckAccept').checked=true;$('documentCheckAccept').dispatchEvent(new Event('change'));$('documentCheckContinue').click();}
   const result=await pending;if(!result?.bytes)throw Error('Export failed: '+$('proStatus').textContent);
   const out=await PDFLib.PDFDocument.load(result.bytes),images=out.context.enumerateIndirectObjects().map(([,v])=>v).filter(v=>v instanceof PDFLib.PDFRawStream&&String(v.dict.get(PDFLib.PDFName.of('Subtype')))==='/Image').map(v=>({filter:String(v.dict.get(PDFLib.PDFName.of('Filter'))),bytes:v.getContents().length,width:String(v.dict.get(PDFLib.PDFName.of('Width'))),height:String(v.dict.get(PDFLib.PDFName.of('Height')))}));
   const task=pdfjsLib.getDocument({data:result.bytes.slice(),...DOC_OPTS});try{
    const pdf=await task.promise,p=await pdf.getPage(1),vp=p.getViewport({scale:1.8}),canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;await p.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
    const black=masks.every(([x,y,w,h])=>canvas.getContext('2d').getImageData(Math.floor((x+w/2)*canvas.width),Math.floor((y+h/2)*canvas.height),1,1).data[0]<25);if(!black)throw Error('Mask pixels changed');
    canvas.id='size-'+label;canvas.style='max-width:46vw;margin:10px;background:white';document.body.append(canvas);
    results.push({label,version:document.querySelector('.app-version').textContent,original:bytes.length,reference:$('proBeforeSize').textContent,referenceLabel:$('proBeforeLabel').textContent,output:result.bytes.length,seconds:+((performance.now()-start)/1000).toFixed(2),pageCount:pdf.numPages,images,maskOpaque:black,composition:$('proComposition').textContent,report:$('proReport').textContent});show();
   }finally{await task.destroy();}
  }
  report.textContent=JSON.stringify(results,null,2)+'\nALL PASSED';document.body.dataset.sizeQA='passed';
 }catch(e){report.textContent=JSON.stringify(results,null,2)+'\nFAIL '+e.stack;document.body.dataset.sizeQA='failed';}
})();
