/* Native regional redaction preserves the remaining PDF text and graphics. */
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

  const safe=new WeakSet(),sourceIds=new WeakMap();let seq=0,cache=null;
  function cacheKey(list,sources){return JSON.stringify(list.map(p=>{const source=sources.get(p.docId);if(source&&!sourceIds.has(source))sourceIds.set(source,++seq);return [sourceIds.get(source),p.uid,p.srcIndex,p.rotation,p.annots||[]];}));}
  function clearCache(){cache=null;}
  async function cached(list,sources,signal){
    const key=cacheKey(list,sources);if(cache?.key!==key)return null;
    signal?.throwIfAborted();const doc=await PDFLib.PDFDocument.load(cache.bytes);signal?.throwIfAborted();
    if(key!==cacheKey(list,sources))throw new DOMException('마스킹 설정이 바뀌었습니다.','AbortError');safe.add(doc);return doc;
  }
  const masksFor=list=>list.map(p=>(p.annots||[]).filter(a=>a.shape==='redaction').map(a=>[a.nx,a.ny,a.nw,a.nh]));
  async function redact(doc,list,{signal,onProgress,sources}={}){
    if(!isMasked(list))return doc;signal?.throwIfAborted();
    const key=sources?cacheKey(list,sources):null,masks=masksFor(list);
    const bytes=await doc.save({useObjectStreams:true,updateFieldAppearances:false});
    const result=await PDFPrivacyNative.run(bytes,masks,{signal,onProgress});signal?.throwIfAborted();
    if(sources&&key!==cacheKey(list,sources))throw new DOMException('마스킹 설정이 바뀌었습니다.','AbortError');
    // One bounded cache of the sanitized document only. Never cache source
    // pixels, rendering canvases, PDF instances or results of Pro settings here.
    cache=sources&&result.bytes.length<=24*1024*1024?{key,bytes:result.bytes}:null;
    const clean=await PDFLib.PDFDocument.load(result.bytes);clean.setProducer('PDF Studio 6.1.1; MuPDF 1.28.1 (AGPL-3.0-or-later); pdf-lib');safe.add(clean);return clean;
  }
  async function flatten(doc,{signal,docOptions={},onProgress,onText,pageSources=[],ocr=[],ocrApplied=false}={}){
    signal?.throwIfAborted();if(pageSources.length!==doc.getPageCount())throw Error('마스킹 문서의 페이지 대응을 확인하지 못했습니다.');
    if(!safe.has(doc))doc=await redact(doc,pageSources,{signal,onProgress});
    const accepted=ocr.filter(r=>pageSources.some(p=>currentOCR(r,p)));
    if(!ocrApplied&&accepted.length)await PDFOCR.apply(doc,accepted,{signal,pageIds:pageSources.map(p=>p.uid)});
    const result=await PDFPrivacyNative.run(await doc.save({useObjectStreams:true,updateFieldAppearances:false}),pageSources.map(()=>[]),{signal,onProgress});signal?.throwIfAborted();
    const clean=await PDFLib.PDFDocument.load(result.bytes);clean.setProducer('PDF Studio 6.1.1; MuPDF 1.28.1 (AGPL-3.0-or-later); pdf-lib');safe.add(clean);
    if(onText){
      let searchable=0,pendingOCR=0;
      const task=pdfjsLib.getDocument({data:result.bytes.slice(),...docOptions});
      try{const pdf=await task.promise;for(let i=0;i<pageSources.length;i++){signal?.throwIfAborted();const p=await pdf.getPage(i+1),has=(await p.getTextContent()).items.some(t=>t.str?.trim());if(has)searchable++;else if(isMasked([pageSources[i]]))pendingOCR++;p.cleanup();}}
      finally{await task.destroy();}
      onText({pages:searchable,ocrPages:accepted.length,pendingOCR,preservedPages:pageSources.length,rasterizedPages:0,maskedPages:pageSources.filter(p=>isMasked([p])).length});
    }
    return clean;
  }
  const inherit=(target,source)=>{if(safe.has(source))safe.add(target);return target;};
  root.PDFPrivacy={isMasked,maskKey,nativeRecord,flatten,redact,cached,clearCache,inherit};
  if(typeof module!=='undefined')module.exports={isMasked,maskKey,nativeRecord,currentOCR};
})(globalThis);
