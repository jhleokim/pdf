/* Shared preview/export path. Raster compression is explicitly opt-in. */
(() => {
  'use strict';
  const check=signal=>{if(signal?.aborted)throw new DOMException('취소했습니다.','AbortError');};
  async function rasterize(doc,options,{signal,docOptions={},onProgress}={}){
    const P=PDFLib,before=await doc.save({useObjectStreams:true,updateFieldAppearances:false});check(signal);
    const task=pdfjsLib.getDocument({data:before.slice(),...docOptions});
    const output=await P.PDFDocument.create();
    const report={imageCount:doc.getPageCount(),sourceImageCount:0,processed:0,changed:0,skipped:0,originalImageBytes:0,resultImageBytes:0,skipReasons:{},notes:[],rasterized:true};
    for(const [,object] of doc.context.enumerateIndirectObjects())if(object instanceof P.PDFRawStream&&String(object.dict.get(P.PDFName.of('Subtype')))==='/Image'){report.originalImageBytes+=object.getContents().length;report.sourceImageCount++;}
    try{
      const pdf=await task.promise;check(signal);
      for(let i=1;i<=pdf.numPages;i++){
        check(signal);const source=await pdf.getPage(i),base=source.getViewport({scale:1});
        const vp=source.getViewport({scale:options.maxDimension/Math.max(base.width,base.height)});
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
        let render;
        const abort=()=>render?.cancel();
        try{
          render=source.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:vp,background:'white',intent:'display'});
          signal?.addEventListener('abort',abort,{once:true});await render.promise;check(signal);
          const image=await PDFPro.encodeCanvas(canvas,options,signal);check(signal);
          const bytes=image.packed?output.context.flateStream(image.bytes).getContents():image.bytes;
          const stream=output.context.stream(bytes,{Type:'XObject',Subtype:'Image',Width:image.width,Height:image.height,BitsPerComponent:image.bits,ColorSpace:image.colorSpace,Filter:image.filter});
          const ref=output.context.register(stream),unit=source.userUnit||1,w=base.width*unit,h=base.height*unit,page=output.addPage([w,h]),key=page.node.newXObject('Page',ref);
          page.pushOperators(P.pushGraphicsState(),P.concatTransformationMatrix(w,0,0,h,0,0),P.drawObject(key),P.popGraphicsState());
          report.changed++;report.processed++;report.resultImageBytes+=bytes.length;
        }catch(e){check(signal);throw e;}
        finally{signal?.removeEventListener('abort',abort);canvas.width=canvas.height=0;source.cleanup();}
        onProgress?.(i/pdf.numPages,'페이지 전체를 압축하는 중…');
        await new Promise(r=>setTimeout(r,0));
      }
      report.notes.push('페이지 이미지 방식: 결과 PDF의 텍스트 검색·복사, 링크·양식은 유지되지 않습니다. 원본 파일은 변경하지 않았습니다.');
      return {doc:output,report};
    }finally{await task.destroy();}
  }
  async function apply(doc,options,callbacks={}){
    const {signal,onProgress}=callbacks;
    check(signal);
    const deskew=await PDFDeskew.processDocument(doc,options,{...callbacks,onProgress:n=>onProgress?.(n*.3,'스캔 기울기를 분석하는 중…')});check(signal);
    let result;
    if(options.rasterize){
      await PDFProDocument.applyDocument(doc,options,callbacks);check(signal);
      result=await rasterize(doc,options,{...callbacks,onProgress:(n,label)=>onProgress?.(.3+n*.7,label)});
    }else{
      const report=await PDFPro.processDocument(doc,options,{signal,onProgress:info=>onProgress?.(.3+.5*(info.total?info.completed/info.total:1),'이미지를 보정하고 압축하는 중…')});check(signal);
      await PDFProDocument.applyDocument(doc,options,{...callbacks,onProgress:n=>onProgress?.(.8+n*.2,'페이지 설정을 적용하는 중…')});
      result={doc,report};
    }
    check(signal);
    result.report.ocr=globalThis.PDFOCR?await PDFOCR.apply(result.doc,options.ocr,callbacks):{pages:0,words:0};
    result.report.stamps=globalThis.PDFStamp?await PDFStamp.apply(result.doc,options.stamps,callbacks):0;
    check(signal);result.report.deskew=deskew;return result;
  }
  globalThis.PDFProPipeline={apply,rasterize};
})();
