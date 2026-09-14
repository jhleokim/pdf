/* Verify retained text after a user-selected crop. No rendering or OCR is run.
 * Boundary-crossing text runs are reported as unchecked, never guessed apart. */
(() => {
  'use strict';
  const clean=text=>String(text||'').replace(/\s/g,''),finite=Number.isFinite;
  const validBox=b=>b&&[b.x,b.y,b.width,b.height].every(finite)&&b.width>0&&b.height>0;
  function retainedBounds(report,options){
    if(!report?.cropped||!validBox(report.cropBounds)||!Array.isArray(report.matrix)||report.matrix.length!==6||!report.matrix.every(finite))return null;
    const b={...report.cropBounds};
    if(options.crop){
      const {rotation:r,userUnit:u}=report,m=options.margins;
      if(![0,90,180,270].includes(r)||!finite(u)||u<=0||!Array.isArray(m)||m.length!==4||!m.every(n=>finite(n)&&n>=0))return null;
      // Same displayed top/right/bottom/left mapping as PDFProDocument.geometry.
      // A4 fitting follows this crop and therefore removes no additional text.
      const [t,rt,bt,l]=m.map(n=>n*72/25.4/u);
      const cuts=r===90?[t,bt,l,rt]:r===180?[rt,l,t,bt]:r===270?[bt,t,rt,l]:[l,rt,bt,t];
      b.x+=cuts[0];b.y+=cuts[2];b.width-=cuts[0]+cuts[1];b.height-=cuts[2]+cuts[3];
    }
    return validBox(b)?b:null;
  }
  function itemCorners(item,style){
    const t=item.transform,width=item.width;
    // PDF.js vertical-writing metrics use a different advance convention. A
    // run without reliable bounds is explicitly unverified on a cropped page.
    if(style?.vertical||item.dir==='ttb'||!Array.isArray(t)||t.length!==6||!t.every(finite)||!finite(width)||width<=0)return null;
    const [a,b,c,d,x,y]=t,advance=Math.hypot(a,b),vertical=Math.hypot(c,d);
    if(!(advance>0&&vertical>0))return null;
    const height=finite(item.height)&&item.height>0?item.height:vertical;
    const ascent=finite(style?.ascent)&&style.ascent>0&&style.ascent<=3?style.ascent:1.2;
    const descent=finite(style?.descent)&&style.descent<=0&&style.descent>=-3?style.descent:-.35;
    const dx=a/advance*width,dy=b/advance*width,ux=c/vertical*height,uy=d/vertical*height;
    const quad=[[x+ux*descent,y+uy*descent],[x+dx+ux*descent,y+dy+uy*descent],
      [x+dx+ux*ascent,y+dy+uy*ascent],[x+ux*ascent,y+uy*ascent]];
    // Conservative padding avoids treating a glyph touching a cut as verified.
    // Use the enclosing source rectangle also for slanted or rotated text runs.
    const pad=Math.max(.5,height*.08),xs=quad.map(p=>p[0]),ys=quad.map(p=>p[1]);
    const l=Math.min(...xs)-pad,r=Math.max(...xs)+pad,bt=Math.min(...ys)-pad,top=Math.max(...ys)+pad;
    return [[l,bt],[r,bt],[r,top],[l,top]];
  }
  function verify(sourceTextContent,resultTextContent,deskewReport,options={}){
    const bounds=retainedBounds(deskewReport,options),source=sourceTextContent?.items,result=resultTextContent?.items;
    if(!bounds||!Array.isArray(source)||!Array.isArray(result))return {ok:false,reason:'invalid-crop-geometry',characters:0,excludedItems:0,unchecked:true,expectedItems:0};
    const matrix=deskewReport.matrix,[a,b,c,d,e,f]=matrix,expected=[];let characters=0,excludedItems=0,excludedCharacters=0;
    for(let index=0;index<source.length;index++){
      const item=source[index],text=clean(item?.str);if(!text)continue;
      const corners=itemCorners(item,sourceTextContent.styles?.[item.fontName]);
      const inside=corners?.every(([x,y])=>{const px=a*x+c*y+e,py=b*x+d*y+f;return px>=bounds.x&&px<=bounds.x+bounds.width&&py>=bounds.y&&py<=bounds.y+bounds.height;});
      if(inside){expected.push({text,index});characters+=text.length;}
      else{excludedItems++;excludedCharacters+=text.length;}
    }
    const joined=result.map(item=>clean(item?.str)).join('');let cursor=0;
    const summary={characters,excludedItems,excludedCharacters,unchecked:expected.length===0,expectedItems:expected.length};
    // Ordered run matching tolerates added page numbers and harmless changes in
    // PDF.js item segmentation. A retained run still must survive in full.
    for(const item of expected){const at=joined.indexOf(item.text,cursor);if(at<0)return {ok:false,reason:'missing-retained-text',missingIndex:item.index,...summary};cursor=at+item.text.length;}
    return {ok:true,reason:'',...summary};
  }
  const api=Object.freeze({verify});globalThis.PDFProTextVerification=api;
  if(typeof module!=='undefined')module.exports=api;
})();
