import * as M from 'mupdf';
import {stripHiddenProperties} from './privacy-content.mjs';
import {imagePlacements} from './compression-placement.mjs';

// Strip non-page data. Content is rewritten and unreachable objects collected,
// never incrementally saved over the original confidential bytes.
function scrub(doc){
  const trailer=doc.getTrailer(),root=trailer.get('Root');
  const keep=new Set(['Type','Pages','Version']);
  const keys=[];root.forEach((_,key)=>keys.push(key));for(const key of keys)if(!keep.has(key))root.delete(key);
  trailer.delete('Info');trailer.delete('ID');root.destroy();trailer.destroy();
  for(let i=0;i<doc.countPages();i++){
    const page=doc.loadPage(i),obj=page.getObject();
    for(const key of ['Annots','Metadata','PieceInfo','AA','Thumb','AF','PresSteps','StructParents'])obj.delete(key);
    obj.destroy();page.destroy();
  }
  const content=new Set(),seen=new Set();
  function visit(obj){
    if(obj.isIndirect()){const id=obj.asIndirect();if(seen.has(id))return;seen.add(id);}
    if(obj.isStream()){
      if(obj.get('Subtype').asName()==='Form')content.add(obj.asIndirect());
      for(const key of ['ActualText','Alt','E','Metadata','PieceInfo'])obj.delete(key);
      const resources=obj.get('Resources');if(!resources.isNull())visit(resources);resources.destroy();return;
    }
    if(obj.isDictionary()){
      for(const key of ['ActualText','Alt','E','Metadata','PieceInfo'])obj.delete(key);
      const contents=obj.get('Contents');
      if(contents.isStream())content.add(contents.asIndirect());
      else if(contents.isArray())contents.forEach(v=>{if(v.isStream())content.add(v.asIndirect());});
      contents.destroy();
    }
    if(obj.isDictionary()||obj.isArray())obj.forEach(v=>visit(v));
  }
  const catalog=doc.getTrailer().get('Root');visit(catalog);catalog.destroy();
  for(const ref of content){const obj=doc.newIndirect(ref),buf=obj.readStream();try{const bytes=buf.asUint8Array(),stripped=stripHiddenProperties(bytes);if(stripped!==bytes)obj.writeStream(stripped);}finally{buf.destroy();obj.destroy();}}
}

// Redaction can turn a JPEG into a lossless ICC image. Convert only images
// created by the redaction operation to ordinary sRGB pixels so the existing
// image optimizer can encode them. Untouched JPEG streams stay untouched.
function normalizeNewImages(doc,first){
  const end=doc.countObjects();let converted=0;
  for(let i=first;i<end;i++){
    const obj=doc.newIndirect(i);let image,pix,rgb;
    try{
      if(!obj.isStream()||obj.get('Subtype').asName()!=='Image'||!obj.get('SMask').isNull()||!obj.get('Mask').isNull()||obj.get('ImageMask').asBoolean())continue;
      const w=obj.get('Width').asNumber(),h=obj.get('Height').asNumber();
      if(!(w>0&&h>0)||w*h>20000000)continue;
      image=doc.loadImage(obj);pix=image.toPixmap();if(pix.getAlpha())continue;
      rgb=pix.convertToColorSpace(M.ColorSpace.DeviceRGB,false);
      const pixels=rgb.getPixels(),stride=rgb.getStride(),bytes=new Uint8Array(w*h*3);
      for(let y=0;y<h;y++)bytes.set(pixels.subarray(y*stride,y*stride+w*3),y*w*3);
      obj.writeStream(bytes);obj.put('ColorSpace',doc.newName('DeviceRGB'));obj.put('BitsPerComponent',8);
      for(const k of ['Filter','DecodeParms','Decode'])obj.delete(k);converted++;
    }finally{rgb?.destroy();pix?.destroy();image?.destroy();obj.destroy();}
  }
  return converted;
}

export async function process(data,progress=()=>{}){
  const started=performance.now(),doc=M.Document.openDocument(data.bytes,'application/pdf');
  try{
    if(!doc.isPDF())throw Error('PDF 문서가 아닙니다.');doc.disableJS();
    if(data.masks.length!==doc.countPages())throw Error('마스킹 페이지 대응이 일치하지 않습니다.');
    // Widgets/comments become regular PDF drawing commands, never page images.
    doc.bake(true,true);let maskedPages=0,convertedImages=0;
    for(let i=0;i<data.masks.length;i++){
      const masks=data.masks[i];if(masks.length){
        const page=doc.loadPage(i),before=doc.countObjects();
        try{
          const [x,y,r,b]=page.getBounds(),w=r-x,h=b-y;
          for(const rect of masks){
            if(rect.length!==4||!rect.every(Number.isFinite)||rect[2]<=0||rect[3]<=0)throw Error('잘못된 마스킹 영역입니다.');
            const [nx,ny,nw,nh]=rect,x1=Math.max(0,nx),y1=Math.max(0,ny),x2=Math.min(1,nx+nw),y2=Math.min(1,ny+nh);
            if(x2<=x1||y2<=y1)throw Error('마스킹 영역이 페이지 밖에 있습니다.');
            const a=page.createAnnotation('Redact');try{a.setRect([x+x1*w,y+y1*h,x+x2*w,y+y2*h]);a.update();}finally{a.destroy();}
          }
          page.applyRedactions(true,M.PDFPage.REDACT_IMAGE_PIXELS,M.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED,M.PDFPage.REDACT_TEXT_REMOVE);
          convertedImages+=normalizeNewImages(doc,before);maskedPages++;
        }finally{page.destroy();}
      }
      progress(i+1,data.masks.length);await new Promise(r=>setTimeout(r,0));
    }
    scrub(doc);
    const out=doc.saveToBuffer('garbage=4,compress=yes');
    try{return {bytes:out.asUint8Array().slice(),maskedPages,convertedImages,seconds:(performance.now()-started)/1000};}finally{out.destroy();}
  }finally{doc.destroy();M.emptyStore();}
}

if(typeof WorkerGlobalScope!=='undefined'){
  self.onmessage=async({data})=>{
    try{const progress=(done,total)=>postMessage({id:data.id,done,total});
      const result=data.operation==='placements'?await imagePlacements(data.bytes,progress):await process(data,progress);
      postMessage({id:data.id,result},result.bytes?[result.bytes.buffer]:[]);}
    catch(e){postMessage({id:data.id,error:e.message||String(e)});}
  };
  postMessage({ready:true});
}
