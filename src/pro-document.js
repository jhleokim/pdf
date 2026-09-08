/* PDF geometry and repeated marks. Content streams stay vector/text based. */
(() => {
  'use strict';
  const P = PDFLib, mm = 72 / 25.4;
  const turn = page => ((page.getRotation().angle % 360) + 360) % 360;
  function visibleBox(page) {
    const m = page.getMediaBox(), c = page.getCropBox();
    const x = Math.max(m.x, c.x), y = Math.max(m.y, c.y);
    return { x, y, width: Math.min(m.x+m.width,c.x+c.width)-x, height: Math.min(m.y+m.height,c.y+c.height)-y };
  }
  function displayToPdf(x,y,b,r) {
    if(r === 90) return [b.x+y,b.y+x];
    if(r === 180) return [b.x+b.width-x,b.y+y];
    if(r === 270) return [b.x+b.width-y,b.y+b.height-x];
    return [b.x+x,b.y+b.height-y];
  }
  function unit(page) {
    const n = page.node.get(P.PDFName.of('UserUnit'));
    const value = n && page.doc.context.lookup(n);
    const u = value instanceof P.PDFNumber ? value.asNumber() : 1;
    return u > 0 && Number.isFinite(u) ? u : 1;
  }
  function translateAnnotations(page, dx, dy) {
    const annots = page.node.Annots();
    if(!annots) return;
    function shift(a) {
      if(!(a instanceof P.PDFArray)) return;
      for(let i=0;i<a.size();i++) {
        const n = a.lookup(i);
        if(n instanceof P.PDFNumber) a.set(i,P.PDFNumber.of(n.asNumber()+(i%2 ? dy : dx)));
      }
    }
    for(let i=0;i<annots.size();i++) {
      const a = annots.lookup(i);
      if(!(a instanceof P.PDFDict)) continue;
      for(const key of ['Rect','QuadPoints','Vertices','L','CL']) shift(a.lookup(P.PDFName.of(key)));
      const ink = a.lookup(P.PDFName.of('InkList'));
      if(ink instanceof P.PDFArray) for(let j=0;j<ink.size();j++) shift(ink.lookup(j));
    }
  }
  function geometry(page, options, number) {
    let b = visibleBox(page);
    if(b.width <= 0 || b.height <= 0) throw new Error(`${number}페이지의 표시 영역을 읽을 수 없습니다.`);
    const u = unit(page), r = turn(page);
    if(options.crop) {
      const sides = options.margins.map(v => v*mm/u);
      const [t,rt,bt,l] = sides;
      const cuts = r===90 ? [t,bt,l,rt] : r===180 ? [rt,l,t,bt] : r===270 ? [bt,t,rt,l] : [l,rt,bt,t];
      b = {x:b.x+cuts[0],y:b.y+cuts[2],width:b.width-cuts[0]-cuts[1],height:b.height-cuts[2]-cuts[3]};
      if(b.width*u < 10*mm || b.height*u < 10*mm) throw new Error(`${number}페이지: 재단 후 크기는 가로·세로 10mm 이상이어야 합니다.`);
      page.setCropBox(b.x,b.y,b.width,b.height);
    }
    if(options.paper === 'a4') {
      // Annotation appearances are rendered separately from the page stream.
      // Do not reveal previously clipped annotations in the new A4 margins.
      const annots=page.node.Annots();
      if(annots)for(let i=0;i<annots.size();i++){
        const annotation=annots.lookup(i);
        if(!(annotation instanceof P.PDFDict))continue;
        const rect=annotation.lookup(P.PDFName.of('Rect'));
        if(!(rect instanceof P.PDFArray)||rect.size()!==4)continue;
        const values=rect.asArray().map(n=>page.doc.context.lookup(n)).map(n=>n instanceof P.PDFNumber?n.asNumber():NaN);
        if(values.every(Number.isFinite)){
          const [x1,y1,x2,y2]=values;
          if(Math.min(x1,x2)<b.x-.01||Math.min(y1,y2)<b.y-.01||Math.max(x1,x2)>b.x+b.width+.01||Math.max(y1,y2)>b.y+b.height+.01)
            throw new Error(`${number}페이지: 재단 경계 밖의 링크·주석이 있어 A4 맞춤을 적용할 수 없습니다. 원래 크기로 저장해 주세요.`);
        }
      }
      // Clip before fitting so content outside an existing crop is not revealed.
      page.node.normalize();
      const start = page.doc.context.register(page.doc.context.contentStream([
        P.pushGraphicsState(), P.rectangle(b.x,b.y,b.width,b.height), P.clip(), P.endPath()
      ]));
      const end = page.doc.context.register(page.doc.context.contentStream([P.popGraphicsState()]));
      page.node.wrapContentStreams(start,end);
      const tw = b.width>b.height ? 297*mm : 210*mm, th = b.width>b.height ? 210*mm : 297*mm;
      const scale = Math.min(tw/b.width,th/b.height);
      const dx = (tw-b.width*scale)/2-b.x*scale, dy = (th-b.height*scale)/2-b.y*scale;
      page.scaleContent(scale,scale);
      page.translateContent(dx,dy);
      page.scaleAnnotations(scale,scale);
      translateAnnotations(page,dx,dy);
      page.node.delete(P.PDFName.of('UserUnit'));
      for(const set of ['setMediaBox','setCropBox','setTrimBox','setBleedBox','setArtBox']) page[set](0,0,tw,th);
      // Subsequent marks belong to the output page, outside the source clip
      // and fit transforms that wrap the existing content streams.
      page.resetPosition();
    }
  }
  async function watermarkImage(doc,text) {
    const canvas = document.createElement('canvas');
    const c = canvas.getContext('2d');
    const font = '600 64px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    c.font=font;
    canvas.width=Math.ceil(c.measureText(text).width)+32; canvas.height=100;
    c.font=font; c.fillStyle='#52647e'; c.textBaseline='middle'; c.fillText(text,16,50);
    const blob = await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob) throw new Error('워터마크 이미지를 만들 수 없습니다.');
    const image = await doc.embedPng(await blob.arrayBuffer());
    canvas.width=canvas.height=0;
    return image;
  }
  async function applyDocument(doc,options,{pageOffset=0,signal,onProgress}={}) {
    const pages=doc.getPages();
    const font=options.number ? await doc.embedFont(P.StandardFonts.Helvetica) : null;
    const mark=options.watermark ? await watermarkImage(doc,options.watermark) : null;
    for(let i=0;i<pages.length;i++) {
      if(signal?.aborted) throw new DOMException('취소했습니다.','AbortError');
      const page=pages[i], ordinal=pageOffset+i;
      geometry(page,options,ordinal+1);
      const b=visibleBox(page), r=turn(page), u=unit(page);
      const w=r%180 ? b.height : b.width, h=r%180 ? b.width : b.height;
      if(font && ordinal>=options.skipPages) {
        const text=String(options.startNumber+ordinal-options.skipPages), size=10/u;
        const tw=font.widthOfTextAtSize(text,size);
        const margin=Math.min(12*mm/u,h*.1,w*.1);
        const x=options.numberPosition==='bottom-right' ? w-margin-tw : (w-tw)/2;
        const [px,py]=displayToPdf(x,h-margin,b,r);
        page.drawText(text,{x:px,y:py,size,font,color:P.rgb(.28,.33,.41),rotate:P.degrees(r)});
      }
      if(mark) {
        const mw=Math.min(w*.65,300/u), mh=mw*mark.height/mark.width;
        const [x,y]=displayToPdf((w-mw)/2,(h+mh)/2,b,r);
        page.drawImage(mark,{x,y,width:mw,height:mh,rotate:P.degrees(r),opacity:.16});
      }
      onProgress?.((i+1)/pages.length);
      if(i%5===0) await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  globalThis.PDFProDocument={applyDocument,geometry,visibleBox,displayToPdf,unit};
})();
