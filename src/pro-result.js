/* Output selection and size accounting, shared by the browser and regression tests. */
(function(root){
  'use strict';
  function unchangedSource(pages,docs){
    if(!pages.length)return null;
    const first=docs.get(pages[0].docId);
    if(!first||first.kind!=='pdf'||pages.length!==first.count)return null;
    if(!pages.every((p,i)=>p.docId===pages[0].docId&&p.srcIndex===i&&p.rotation===0&&!(p.annots?.length)))return null;
    return first.libBytes;
  }
  function compressionOnly(o){
    return o.optimize&&!o.blackWhite&&!o.grayscale&&!o.contrast&&o.whitePoint===255&&!o.deskew&&!o.crop&&o.paper==='original'&&!o.number&&!o.watermark&&!o.stamps?.length&&!o.ocr?.length;
  }
  function selectOutput(before,candidate,options,original){
    const reference=original||before;
    let bytes=candidate,retained=false;
    if(compressionOnly(options)){
      const baseline=original&&original.length<before.length?original:before;
      if(candidate.length>=baseline.length){bytes=baseline;retained=true;}
    }
    return {bytes,reference,retained,originalBasis:!!original,
      reduction:(1-bytes.length/reference.length)*100,
      structureSaved:original?Math.max(0,original.length-before.length):0};
  }
  const api=Object.freeze({unchangedSource,compressionOnly,selectOutput});
  root.PDFProResult=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
