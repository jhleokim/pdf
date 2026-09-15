(async()=>{
 const report=document.createElement('pre');report.id='v52OCRChecks';report.style='position:fixed;bottom:0;left:0;z-index:99999;background:white;color:black;padding:12px';document.body.append(report);
 const lines=[],assert=(v,text)=>{if(!v)throw Error(text);lines.push('PASS '+text);report.textContent=lines.join('\n');};
 try{
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=500;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,500);ctx.fillStyle='black';ctx.font='64px Arial';ctx.fillText('CONTRACT AMOUNT',45,120);ctx.fillText('123456',45,240);ctx.fillText('TOTAL 987654',45,360);
  const doc=await PDFDocument.create(),image=await doc.embedPng(canvas.toDataURL()),p=doc.addPage([400,600]);p.drawText('DIGITAL HEADER',{x:30,y:555,size:16});p.drawImage(image,{x:25,y:220,width:350,height:146});
  await loadFiles([new File([await doc.save()],'mixed-ocr-fixture.pdf',{type:'application/pdf'})]);$('proOptimize').checked=false;$('proDeskew').checked=false;refreshProControls();
  for(const provider of ['paddle-v5','tesseract']){
    $('ocrProvider').value=provider;configureLocalOCR();report.textContent=lines.join('\n')+'\nRunning '+provider;
    await runOCR(false,provider,[pages[0]]);const r=ocrRecords.find(r=>r.uid===pages[0].uid&&r.source===provider);
    assert(!!r&&!r.skipped,provider+' recognizes mixed scan instead of skipping');
    assert(r.text.includes('123456')&&r.text.includes('987654'),provider+' preserves both scanned numbers');
    assert(!r.text.includes('DIGITAL HEADER'),provider+' does not duplicate existing digital header');
  }
  report.textContent=lines.join('\n')+'\nALL PASSED';document.body.dataset.ocrQA='passed';
 }catch(e){report.textContent=lines.join('\n')+'\nFAIL '+e.stack;document.body.dataset.ocrQA='failed';console.error(e);}
})();
