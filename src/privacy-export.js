/* A private export starts a NEW document and imports only burned-in page pixels.
   Never copy source PDF objects, hidden OCR, annotations, metadata or attachments. */
(function(root){
  'use strict';
  const isMasked=pages=>pages.some(p=>p.annots?.some(a=>a.shape==='redaction'));
  async function preparePage(doc,target,source,signal){
    signal?.throwIfAborted();const base=source.getViewport({scale:1,rotation:0});
    const scale=Math.min(200/72,Math.sqrt(12000000/(base.width*base.height)),12000/Math.max(base.width,base.height));
    const viewport=source.getViewport({scale,rotation:0}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    let render;const abort=()=>render?.cancel();
    try{
      render=source.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,background:'white',intent:'print'});signal?.addEventListener('abort',abort,{once:true});await render.promise;signal?.throwIfAborted();
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('마스킹 페이지를 준비하지 못했습니다.');
      const image=await doc.embedPng(await blob.arrayBuffer()),P=PDFLib,N=P.PDFName.of,box=source.view;
      // Flatten widgets BEFORE drawing masks: an annotation appearance must never
      // be painted over a mask by the PDF viewer during the final render.
      target.node.set(N('Contents'),doc.context.obj([]));target.node.set(N('Resources'),doc.context.obj({}));target.node.set(N('Annots'),doc.context.obj([]));
      target.drawImage(image,{x:box[0],y:box[1],width:box[2]-box[0],height:box[3]-box[1]});
    }finally{signal?.removeEventListener('abort',abort);canvas.width=canvas.height=0;}
  }
  async function flatten(doc,{signal,docOptions={},onProgress,dpi=200}={}){
    const check=()=>signal?.throwIfAborted();check();
    const bytes=await doc.save({useObjectStreams:true,updateFieldAppearances:false});check();
    const task=pdfjsLib.getDocument({data:bytes,...docOptions}),output=await PDFLib.PDFDocument.create();
    try{
      const pdf=await task.promise;check();
      for(let n=1;n<=pdf.numPages;n++){
        check();const source=await pdf.getPage(n),base=source.getViewport({scale:1});
        const scale=Math.min(dpi/72,Math.sqrt(12000000/(base.width*base.height)),12000/Math.max(base.width,base.height));
        const vp=source.getViewport({scale}),canvas=document.createElement('canvas');
        canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);let render;
        const abort=()=>render?.cancel();
        try{
          render=source.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:vp,background:'white',intent:'print'});
          signal?.addEventListener('abort',abort,{once:true});await render.promise;check();
          const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));check();
          if(!blob)throw Error('개인정보 마스킹 이미지를 만들지 못했습니다.');
          const image=await output.embedPng(await blob.arrayBuffer());check();
          const unit=source.userUnit||1,page=output.addPage([base.width*unit,base.height*unit]);
          page.drawImage(image,{x:0,y:0,width:page.getWidth(),height:page.getHeight()});
        }finally{signal?.removeEventListener('abort',abort);canvas.width=canvas.height=0;source.cleanup();}
        onProgress?.(n,pdf.numPages);await new Promise(r=>setTimeout(r,0));
      }
      // PDF-lib's default producer/dates are not source document metadata.
      output.setTitle('');output.setAuthor('');output.setSubject('');output.setKeywords([]);
      return output;
    }finally{await task.destroy();}
  }
  root.PDFPrivacy={isMasked,flatten,preparePage};
  if(typeof module!=='undefined')module.exports={isMasked};
})(globalThis);
