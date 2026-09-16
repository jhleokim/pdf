import * as M from 'mupdf';

// Inspection only. Never bake annotations, scrub metadata, or rewrite this PDF.
// Device CTMs include nested Forms, page rotation and UserUnit. Keep the largest
// use of every shared image; uncertain/dynamic documents use the pixel cap only.
export async function imagePlacements(bytes, progress=()=>{}) {
  if(bytes.length>64*1024*1024)return {placements:{},reason:'large'};
  const doc=M.Document.openDocument(bytes,'application/pdf'),held=[],placements={};
  let device;
  try {
    if(!doc.isPDF())throw Error('PDF 문서가 아닙니다.');doc.disableJS();
    if(doc.countPages()>300||doc.countObjects()>50000)return {placements:{},reason:'large'};
    const catalog=doc.getTrailer().get('Root');
    try {for(const key of ['AcroForm','OCProperties']){const value=catalog.get(key);try{if(!value.isNull())return {placements:{},reason:'dynamic'};}finally{value.destroy();}}}finally{catalog.destroy();}
    for(let i=0;i<doc.countPages();i++){
      const page=doc.findPage(i),annots=page.get('Annots');
      try{if(annots.length)return {placements:{},reason:'dynamic'};}finally{annots.destroy();page.destroy();}
    }
    const images=new Map();
    for(let i=1;i<doc.countObjects();i++){
      const ref=doc.newIndirect(i),sub=ref.get('Subtype'),type=ref.get('Type');
      try{
        if(type.asName()==='Pattern')return {placements:{},reason:'pattern'};
        if(!ref.isStream()||sub.asName()!=='Image')continue;
        if(held.length>=2000)return {placements:{},reason:'large'};
        const image=doc.loadImage(ref);held.push(image);
        const refs=images.get(image.pointer)||[];refs.push(i);images.set(image.pointer,refs);
      }finally{sub.destroy();type.destroy();ref.destroy();}
    }
    device=new M.Device({fillImage(image,ctm){
      const refs=images.get(image.pointer);if(!refs)return;
      const width=Math.hypot(ctm[0],ctm[1]),height=Math.hypot(ctm[2],ctm[3]);
      if(!Number.isFinite(width+height)||width<=0||height<=0)return;
      for(const ref of refs){const old=placements[ref]||[0,0];placements[ref]=[Math.max(width,old[0]),Math.max(height,old[1])];}
    }});
    for(let i=0;i<doc.countPages();i++){
      const page=doc.loadPage(i);try{page.run(device,M.Matrix.identity);}finally{page.destroy();}
      progress(i+1,doc.countPages());await new Promise(r=>setTimeout(r,0));
    }
    device.close();return {placements};
  }finally{device?.destroy();for(const image of held)image.destroy();doc.destroy();M.emptyStore();}
}
