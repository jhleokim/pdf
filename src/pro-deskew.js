/* Offline line-projection deskew. The raster is used only for measurement;
 * the PDF content (including hidden OCR) is transformed without flattening. */
(() => {
  'use strict';
  const rad = Math.PI / 180;
  function detect({data,width,height}) {
    const unchanged = reason => ({angle:0,reason,confidence:0});
    const hist=new Uint32Array(256), gray=new Uint8Array(width*height);
    let total=0,sum=0;
    const pad=Math.ceil(Math.min(width,height)*.05);
    for(let y=pad;y<height-pad;y++)for(let x=pad;x<width-pad;x++){
      const i=y*width+x,j=i*4,a=data[j+3]/255;
      const v=Math.round((.299*data[j]+.587*data[j+1]+.114*data[j+2])*a+255*(1-a));
      gray[i]=v;hist[v]++;total++;sum+=v;
    }
    let weight=0,partial=0,variance=0,threshold=0;
    for(let t=0;t<255;t++){
      weight+=hist[t];partial+=hist[t]*t;
      if(!weight||weight===total)continue;
      const delta=partial/weight-(sum-partial)/(total-weight);
      const value=weight*(total-weight)*delta*delta;
      if(value>variance){variance=value;threshold=t;}
    }
    if(!variance)return unchanged('빈 페이지 또는 글줄 없음');
    threshold=Math.min(180,threshold+12);
    const points=[];let dark=0;
    for(let y=pad;y<height-pad;y+=2)for(let x=pad;x<width-pad;x+=2){
      if(gray[y*width+x]<=threshold){points.push([x-width/2,y]);dark++;}
    }
    if(dark<300)return unchanged('감지할 글줄 부족');
    if(dark/(total/4)>.28)return unchanged('사진·짙은 배경으로 각도 불확실');
    // Bound CPU work on dense pages without favoring one part of the page.
    const step=Math.max(1,Math.ceil(points.length/24000));
    const sampled=points.filter((_,i)=>i%step===0);
    function score(angle,source){
      const slope=Math.tan(angle*rad),rows=new Float64Array(Math.ceil(Math.max(width,height)/2)+200);
      for(const [x,y] of source){
        const row=(y-x*slope)/2+100,lo=Math.floor(row),f=row-lo;
        rows[lo]+=1-f;rows[lo+1]+=f;
      }
      let value=0;
      for(let i=1;i<rows.length;i++)value+=(rows[i]-rows[i-1])**2;
      return value;
    }
    function search(source){
      let angle=0,best=-1,mean=0;
      for(let a=-7;a<=7;a+=.5){const s=score(a,source);mean+=s;if(s>best){best=s;angle=a;}}
      const center=angle;
      for(let n=-5;n<=5;n++){
        const a=center+n*.1;if(Math.abs(a)>7)continue;
        const s=score(a,source);if(s>best){best=s;angle=a;}
      }
      return {angle:Math.round(angle*10)/10,peak:best/(mean/29||1),gain:best/(score(0,source)||1),strength:best};
    }
    const result=search(sampled);
    if(Math.abs(result.angle)<.2)return unchanged('이미 수평인 페이지');
    if(Math.abs(result.angle)>=6.9||result.peak<1.65||result.gain<1.25)return unchanged('신뢰할 수 있는 기울기 없음');
    const vertical=search(sampled.map(([x,y])=>[y-height/2,x+width/2]));
    if(vertical.strength>result.strength*1.25)return unchanged('세로 방향 글줄 · 가로 방향으로 회전 후 사용');
    // Text in two independent vertical regions must agree. This rejects most
    // illustrations, photos, and pages with conflicting text orientations.
    const ys=sampled.map(p=>p[1]).sort((a,b)=>a-b),middle=ys[Math.floor(ys.length/2)];
    const upper=search(sampled.filter(p=>p[1]<middle)),lower=search(sampled.filter(p=>p[1]>=middle));
    if(upper.peak<1.4||lower.peak<1.4||Math.abs(upper.angle-lower.angle)>.7||Math.abs(upper.angle-result.angle)>.7)
      return unchanged('영역별 글줄 방향이 달라 원본 유지');
    return {angle:result.angle,confidence:result.peak,reason:''};
  }
  function matrix(box,angle){
    const c=Math.cos(angle*rad),s=Math.sin(angle*rad),w=box.width,h=box.height;
    const scale=Math.min(w/(Math.abs(c)*w+Math.abs(s)*h),h/(Math.abs(s)*w+Math.abs(c)*h));
    const a=c*scale,b=s*scale,cx=box.x+w/2,cy=box.y+h/2;
    return [a,b,-b,a,cx-a*cx+b*cy,cy-b*cx-a*cy];
  }
  function apply(page,angle){
    if(!Number.isFinite(angle)||Math.abs(angle)>7)throw new Error('자동 보정 범위를 벗어난 각도입니다.');
    if(!angle)return false;
    if(page.node.Annots()?.size())return false;
    const P=PDFLib,box=PDFProDocument.visibleBox(page),ctx=page.doc.context;
    page.node.normalize();
    const start=ctx.register(ctx.contentStream([
      P.pushGraphicsState(),P.concatTransformationMatrix(...matrix(box,angle)),
      P.rectangle(box.x,box.y,box.width,box.height),P.clip(),P.endPath()
    ]));
    const end=ctx.register(ctx.contentStream([P.popGraphicsState()]));
    page.node.wrapContentStreams(start,end);
    page.resetPosition();
    return true;
  }
  async function processDocument(doc,options,{signal,docOptions={},pageOffset=0,onProgress}={}){
    const report={changed:0,pages:[]};
    if(!options.deskew)return report;
    const check=()=>{if(signal?.aborted)throw new DOMException('취소했습니다.','AbortError');};
    check();
    const bytes=await doc.save({useObjectStreams:true,updateFieldAppearances:false});check();
    const task=pdfjsLib.getDocument({data:bytes,...docOptions});
    let pdf;
    try{
      pdf=await task.promise;check();
      for(let i=0;i<pdf.numPages;i++){
        check();const page=doc.getPage(i);let result;
        if(page.node.Annots()?.size())result={angle:0,reason:'링크·주석·양식 위치 보존을 위해 유지'};
        else{
          const source=await pdf.getPage(i+1),base=source.getViewport({scale:1});check();
          const vp=source.getViewport({scale:Math.min(2,1200/Math.max(base.width,base.height))});
          const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
          const context=canvas.getContext('2d',{willReadFrequently:true});
          let render;
          const abort=()=>render?.cancel();
          try{
            render=source.render({canvasContext:context,viewport:vp,background:'white'});
            signal?.addEventListener('abort',abort,{once:true});
            await render.promise;check();
            result=detect(context.getImageData(0,0,canvas.width,canvas.height));check();
          }catch(e){check();throw e;}
          finally{signal?.removeEventListener('abort',abort);canvas.width=canvas.height=0;source.cleanup();}
          if(result.angle&&apply(page,result.angle))report.changed++;
        }
        report.pages.push({page:pageOffset+i+1,...result});
        onProgress?.((i+1)/pdf.numPages);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }finally{await task.destroy();}
    return report;
  }
  globalThis.PDFDeskew={detect,matrix,apply,processDocument};
  if(typeof module!=='undefined')module.exports=globalThis.PDFDeskew;
})();
