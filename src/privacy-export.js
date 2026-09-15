/* Rebuild page pixels, then add only current OCR from the masked rendering.
   Unmasked pages retain text through fresh Unicode streams, never source objects. */
(function(root){
  'use strict';
  const isMasked=pages=>pages.some(p=>p.annots?.some(a=>a.shape==='redaction'));
  const maskKey=p=>JSON.stringify([p.docId,p.srcIndex,p.rotation,(p.annots||[]).filter(a=>a.shape==='redaction').map(a=>[a.nx,a.ny,a.nw,a.nh])]);
  const currentOCR=(record,page)=>page.uid!=null&&record.uid===page.uid&&record.privacyKey===maskKey(page)&&record.words?.some(w=>w.text?.trim());
  function nativeRecord(content,viewport,uid){
    const v=viewport.transform,w=viewport.width,h=viewport.height,words=[];
    for(const item of content.items||[]){
      const m=item.transform;if(!item.str?.trim()||!Array.isArray(m)||m.length!==6||!m.every(Number.isFinite)||!(item.width>0))continue;
      const length=Math.hypot(m[0],m[1]);if(!length)continue;
      const x=v[0]*m[4]+v[2]*m[5]+v[4],y=v[1]*m[4]+v[3]*m[5]+v[5];
      const dx=(v[0]*m[0]+v[2]*m[1])*item.width/length,dy=(v[1]*m[0]+v[3]*m[1])*item.width/length;
      const ux=v[0]*m[2]+v[2]*m[3],uy=v[1]*m[2]+v[3]*m[3];
      const xs=[x,x+dx,x+ux,x+dx+ux],ys=[y,y+dy,y+uy,y+dy+uy];
      const box=[Math.max(0,Math.min(...xs)/w),Math.max(0,Math.min(...ys)/h),Math.min(1,Math.max(...xs)/w),Math.min(1,Math.max(...ys)/h)];
      if(!box.every(Number.isFinite)||box[2]<=box[0]||box[3]<=box[1])continue;
      words.push({text:item.str,separator:'',box,nativeBasis:[x/w,y/h,dx/w,dy/h,ux/w,uy/h]});
    }
    return {uid,words,granularity:'line'};
  }
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
  async function flatten(doc,{signal,docOptions={},onProgress,onText,dpi=200,pageSources=[],ocr=[]}={}){
    const check=()=>signal?.throwIfAborted();check();
    const bytes=await doc.save({useObjectStreams:true,updateFieldAppearances:false});check();
    const task=pdfjsLib.getDocument({data:bytes,...docOptions}),output=await PDFLib.PDFDocument.create();
    try{
      const pdf=await task.promise;check();
      if(pageSources.length!==pdf.numPages)throw Error('마스킹 문서의 페이지 대응을 확인하지 못했습니다.');
      const records=[],pageIds=pageSources.map((p,i)=>p.uid??'private-page-'+i);let ocrPages=0,nativePages=0,pendingOCR=0;
      for(let n=1;n<=pdf.numPages;n++){
        check();const source=await pdf.getPage(n),base=source.getViewport({scale:1});
        const input=pageSources[n-1],uid=pageIds[n-1];
        if(isMasked([input])){
          // Never recover text from this PDF page: it can include hidden text
          // under a mask. Only the explicitly accepted masked-image OCR is safe.
          const record=ocr.find(r=>currentOCR(r,input));
          if(record){records.push({...record,uid});ocrPages++;}else pendingOCR++;
        }else{
          const record=nativeRecord(await source.getTextContent(),base,uid);check();
          if(record.words.length){records.push(record);nativePages++;}
        }
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
      const text=await PDFOCR.apply(output,records,{pageIds,signal});check();
      onText?.({...text,ocrPages,nativePages,pendingOCR});
      return output;
    }finally{await task.destroy();}
  }
  root.PDFPrivacy={isMasked,maskKey,nativeRecord,flatten,preparePage};
  if(typeof module!=='undefined')module.exports={isMasked,maskKey,nativeRecord,currentOCR};
})(globalThis);
