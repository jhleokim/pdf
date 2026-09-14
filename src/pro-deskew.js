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
  function geometry(box,angle){
    if(!Number.isFinite(angle)||Math.abs(angle)>60)throw new Error('회전 각도는 −60°부터 +60°까지 입력해 주세요.');
    if(!box||![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0)
      throw new Error('페이지의 표시 영역을 읽을 수 없습니다.');
    const c=Math.cos(angle*rad),s=Math.sin(angle*rad),w=box.width,h=box.height,cx=box.x+w/2,cy=box.y+h/2;
    const width=Math.abs(c)*w+Math.abs(s)*h,height=Math.abs(s)*w+Math.abs(c)*h;
    return {matrix:[c,s,-s,c,cx-c*cx+s*cy,cy-s*cx-c*cy],bounds:{x:cx-width/2,y:cy-height/2,width,height}};
  }
  function matrix(box,angle){return geometry(box,angle).matrix;}
  function apply(page,angle){
    if(!Number.isFinite(angle)||Math.abs(angle)>60)throw new Error('회전 각도는 −60°부터 +60°까지 입력해 주세요.');
    if(!angle)return false;
    if(page.node.Annots()?.size())return false;
    const P=PDFLib,box=PDFProDocument.visibleBox(page),ctx=page.doc.context;
    const transformed=geometry(box,angle),b=transformed.bounds;
    page.node.normalize();
    const start=ctx.register(ctx.contentStream([
      P.pushGraphicsState(),P.concatTransformationMatrix(...transformed.matrix),
      // Retain the original visible region, including a pre-existing crop. Use
      // all four vertices: bundled PDF.js clips the rotated `re` rectangle as
      // though its diagonal were the full bounds, losing the other two corners.
      P.moveTo(box.x,box.y),P.lineTo(box.x+box.width,box.y),
      P.lineTo(box.x+box.width,box.y+box.height),P.lineTo(box.x,box.y+box.height),
      P.closePath(),P.clip(),P.endPath()
    ]));
    const end=ctx.register(ctx.contentStream([P.popGraphicsState()]));
    page.node.wrapContentStreams(start,end);
    // Do not shrink text or retain a page boundary that can cut off its corners.
    // /Rotate and /UserUnit stay intact, so display and physical units agree.
    for(const set of ['setMediaBox','setCropBox','setTrimBox','setBleedBox','setArtBox'])page[set](b.x,b.y,b.width,b.height);
    page.resetPosition();
    return true;
  }
  async function processDocument(doc,options,{signal,docOptions={},pageOffset=0,pageIds=[],deskewCache,deskewKeys=[],onProgress}={}){
    const report={changed:0,pages:[]};
    const overrides=options.deskewAngles||{},own=(o,k)=>k!==undefined&&Object.prototype.hasOwnProperty.call(o,k);
    const cache=deskewCache instanceof Map?deskewCache:null;
    function measured(key){
      if(!cache||typeof key!=='string'||!key)return null;
      const item=cache.get(key);
      if(!item||!Number.isFinite(item.angle)||Math.abs(item.angle)>7||typeof item.reason!=='string')return null;
      // Refresh LRU order without retaining the document, canvas or pixel data.
      cache.delete(key);cache.set(key,item);
      return {angle:item.angle,reason:item.reason,confidence:item.confidence};
    }
    function remember(key,result){
      if(!cache||typeof key!=='string'||!key)return;
      cache.delete(key);cache.set(key,{angle:result.angle,reason:result.reason,confidence:result.confidence});
      while(cache.size>128)cache.delete(cache.keys().next().value);
    }
    const check=()=>{if(signal?.aborted)throw new DOMException('취소했습니다.','AbortError');};
    check();
    // Resolve by stable UID, never by the transient preview/export page index.
    // Manual 0 means keep this page level as supplied, rather than run detection.
    const plans=doc.getPages().map((page,i)=>{
      const pageId=pageIds[i],manual=own(overrides,pageId),angle=manual?overrides[pageId]:undefined;
      if(manual&&(!Number.isFinite(angle)||Math.abs(angle)>60))throw new Error(`${pageOffset+i+1}페이지: 회전 각도는 −60°부터 +60°까지 입력해 주세요.`);
      if(manual&&angle&&page.node.Annots()?.size())throw new Error(`${pageOffset+i+1}페이지: 링크·주석·양식이 있어 위치를 보존해야 하므로 기울기를 변경할 수 없습니다. 이 페이지를 자동 또는 0°로 되돌려 주세요.`);
      return {page,pageId,manual,angle};
    });
    if(!options.deskew&&!plans.some(p=>p.manual))return report;
    let task,pdf;
    try{
      for(let i=0;i<plans.length;i++){
        check();const {page,pageId,manual,angle}=plans[i];let result;
        if(manual){
          // UI angles use the familiar clockwise-positive convention. PDF
          // matrices and detect() use counterclockwise-positive coordinates.
          result={mode:'manual',requestedAngle:angle,angle:angle?-angle:0,displayAngle:angle,reason:angle?'':'수동 0° · 원본 각도 유지'};
        }
        else if(!options.deskew)result={mode:'off',angle:0,displayAngle:0,reason:'자동 보정 사용 안 함'};
        else if(page.node.Annots()?.size())result={mode:'auto',angle:0,displayAngle:0,reason:'링크·주석·양식 위치 보존을 위해 유지'};
        else{
          const cached=measured(deskewKeys[i]);
          if(cached)result={mode:'auto',...cached};
          else{
            // Manual-only work requires no raster render or PDF.js initialization.
            if(!pdf){
              const bytes=await doc.save({useObjectStreams:true,updateFieldAppearances:false});check();
              task=pdfjsLib.getDocument({data:bytes,...docOptions});pdf=await task.promise;check();
            }
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
              result={mode:'auto',...detect(context.getImageData(0,0,canvas.width,canvas.height))};check();
              remember(deskewKeys[i],result);
            }catch(e){check();throw e;}
            finally{signal?.removeEventListener('abort',abort);canvas.width=canvas.height=0;source.cleanup();}
          }
          result.displayAngle=result.angle?-result.angle:0;
        }
        result.changed=!!result.angle&&apply(page,result.angle);
        if(result.changed)report.changed++;
        report.pages.push({page:pageOffset+i+1,pageId,...result});
        onProgress?.((i+1)/plans.length);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }finally{await task?.destroy();}
    return report;
  }
  globalThis.PDFDeskew={detect,geometry,matrix,apply,processDocument};
  if(typeof module!=='undefined')module.exports=globalThis.PDFDeskew;
})();
