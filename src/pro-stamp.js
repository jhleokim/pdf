/* Paper removal is reversible: source pixels stay separate from the alpha mask. */
(function(root){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function removePaper(source,{strength=35,color='original'}={}){
    const out=new Uint8ClampedArray(source.length),cut=clamp(255-strength*1.1,100,255);
    for(let i=0;i<source.length;i+=4){
      const [r,g,b,a]=source.subarray(i,i+4),low=Math.min(r,g,b),high=Math.max(r,g,b);
      // Keep saturated ink; a neutral paper pixel becomes progressively transparent.
      const chroma=high-low,ink=Math.max(chroma<strength*.55?0:chroma,cut-low),alpha=clamp(ink/Math.max(35,cut)*255,0,255);
      const opacity=strength===0?a:Math.round(a*alpha/255);
      out[i+3]=opacity;
      if(color==='red'){out[i]=170;out[i+1]=28;out[i+2]=38;}
      else if(color==='black'){out[i]=out[i+1]=out[i+2]=28;}
      else if(strength===0){out[i]=r;out[i+1]=g;out[i+2]=b;}
      else {const t=Math.max(.01,alpha/255);out[i]=clamp((r-255*(1-t))/t,0,255);out[i+1]=clamp((g-255*(1-t))/t,0,255);out[i+2]=clamp((b-255*(1-t))/t,0,255);}
    }
    return out;
  }
  function bounds(data,width,height){
    let left=width,top=height,right=-1,bottom=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>20){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    if(right<left)return null;
    return {x:Math.max(0,left-3),y:Math.max(0,top-3),width:Math.min(width-1,right+3)-Math.max(0,left-3)+1,height:Math.min(height-1,bottom+3)-Math.max(0,top-3)+1};
  }
  function placement(mark,pageWidth,pageHeight){
    const mm=72/25.4, width=Math.min(mark.width*mm,pageWidth,pageHeight*mark.ratio),height=width/mark.ratio;
    let x=mark.x*mm,y=mark.y*mm;
    if(mark.anchor.includes('right'))x=pageWidth-width-x;
    if(mark.anchor.includes('bottom'))y=pageHeight-height-y;
    return {x:clamp(x,0,pageWidth-width),y:clamp(y,0,pageHeight-height),width,height};
  }
  async function apply(doc,marks,{pageIds=[],signal}={}){
    if(!marks?.length)return 0;
    const P=root.PDFLib,G=root.PDFProDocument;let count=0;
    for(const mark of marks){
      const targets=doc.getPages().map((page,i)=>({page,i})).filter(({i})=>mark.scope==='all'||mark.targets.includes(pageIds[i]));
      if(!targets.length)continue;
      if(signal?.aborted)throw new DOMException('취소했습니다.','AbortError');
      const image=await doc.embedPng(mark.data);
      for(const {page} of targets){
        const b=G.visibleBox(page),r=((page.getRotation().angle%360)+360)%360,u=G.unit(page);
        const w=(r%180?b.height:b.width)*u,h=(r%180?b.width:b.height)*u;
        const box=placement(mark,w,h),[x,y]=G.displayToPdf(box.x/u,(box.y+box.height)/u,b,r);
        page.drawImage(image,{x,y,width:box.width/u,height:box.height/u,rotate:P.degrees(r),opacity:mark.opacity});count++;
      }
    }
    return count;
  }
  root.PDFStamp={removePaper,bounds,placement,apply};
  if(typeof module!=='undefined')module.exports=root.PDFStamp;
})(globalThis);
