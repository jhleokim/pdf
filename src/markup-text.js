/* Embedded fonts supply identical Korean/Latin metrics in the editor and PDF. */
const PDFMarkupText=(()=>{
  const families={gothic:{name:'나눔고딕',family:'PDFStudioGothic',asset:'markup-font-gothic'},myeongjo:{name:'나눔명조',family:'PDFStudioMyeongjo',asset:'markup-font-myeongjo'}};
  const fonts=new Map();let boot;
  // Synthetic emphasis keeps both embedded Korean families available offline.
  const boldStroke=.035,strikeWidth=.05,italicSlope=Math.tan(14*Math.PI/180);
  function data(id){return b64bytes(document.getElementById(id).textContent.trim());}
  async function load(id='gothic'){
    if(!families[id])throw Error('지원하지 않는 글꼴입니다.');
    if(!boot)boot=Promise.resolve().then(()=>{const script=document.createElement('script');script.textContent=new TextDecoder().decode(data('markup-fontkit'));document.head.appendChild(script);});
    await boot;
    if(!fonts.has(id))fonts.set(id,(async()=>{
      const context=PDFLib.PDFContext.create();
      const bytes=PDFLib.decodePDFRawStream(PDFLib.PDFRawStream.of(context.obj({Filter:'FlateDecode'}),data(families[id].asset))).decode();
      const font=fontkit.create(bytes),face=new FontFace(families[id].family,bytes);
      await face.load();document.fonts.add(face);return {font,bytes};
    })());
    try{return await fonts.get(id);}catch(e){fonts.delete(id);throw e;}
  }
  function clean(text){return String(text).replace(/\r\n?/g,'\n').replace(/\t/g,'    ').normalize('NFC');}
  function layout(font,text,size,lineGap=1.3,maxWidth=Infinity){
    const paragraphs=clean(text).split('\n'),lines=[],scale=size/font.unitsPerEm;
    if(text.length>2000||paragraphs.length>30)throw Error('텍스트 상자는 2,000자·30줄까지 입력할 수 있습니다.');
    for(const ch of text){if(ch!=='\n'&&!font.hasGlyphForCodePoint(ch.codePointAt(0)))throw Error('이 글꼴에 없는 문자가 있습니다. 한글·영문·숫자와 기본 기호를 사용해 주세요.');}
    for(const paragraph of paragraphs){
      let line='',width=0;
      for(const ch of paragraph){const advance=font.glyphForCodePoint(ch.codePointAt(0)).advanceWidth*scale;
        while(line&&width+advance>maxWidth){
          const space=line.lastIndexOf(' ');
          if(space>0){lines.push(line.slice(0,space));line=line.slice(space+1);width=[...line].reduce((n,c)=>n+font.glyphForCodePoint(c.codePointAt(0)).advanceWidth*scale,0);}
          else{lines.push(line);line='';width=0;}
        }
        line+=ch;width+=advance;
      }lines.push(line);
    }
    const widths=lines.map(line=>font.layout(line).glyphs.reduce((sum,g)=>sum+g.advanceWidth,0)*scale);
    const ascent=font.ascent*scale,descent=-font.descent*scale,step=Math.max(size*lineGap,ascent+descent);
    return {lines,widths,width:Math.max(size*.35,...widths),height:ascent+descent+(lines.length-1)*step,ascent,step};
  }
  function svg(a,w,h){
    const g=document.createElementNS(SVGNS,'g');g.setAttribute('class','anno');g.dataset.uid=a.id;
    const box=document.createElementNS(SVGNS,'rect');
    for(const [k,v] of Object.entries({x:a.nx*w,y:a.ny*h,width:a.nw*w,height:a.nh*h,fill:'transparent'}))box.setAttribute(k,v);
    g.appendChild(box);
    const sx=a.nw*w/a.textLayout.width,sy=a.nh*h/a.textLayout.height;
    a.textLayout.lines.forEach((line,i)=>{
      if(!line)return;
      const t=document.createElementNS(SVGNS,'text'),x=a.nx*w,y=a.ny*h+(a.textLayout.ascent+i*a.textLayout.step)*sy;
      for(const [k,v] of Object.entries({x,y,fill:a.color,'font-family':families[a.font].family,'font-size':a.fontSize*sy,'textLength':a.textLayout.widths[i]*sx,'lengthAdjust':'spacingAndGlyphs','xml:space':'preserve'}))t.setAttribute(k,v);
      if(a.bold){t.setAttribute('stroke',a.color);t.setAttribute('stroke-width',a.fontSize*sy*boldStroke);t.setAttribute('stroke-linejoin','round');}
      if(a.italic)t.setAttribute('transform',`matrix(1 0 ${-italicSlope} 1 ${italicSlope*y} 0)`);
      t.textContent=line;g.appendChild(t);
      if(a.strike){const strike=document.createElementNS(SVGNS,'line'),at=y-a.fontSize*.3*sy;for(const [k,v] of Object.entries({x1:x,y1:at,x2:x+a.textLayout.widths[i]*sx,y2:at,stroke:a.color,'stroke-width':a.fontSize*sy*strikeWidth}))strike.setAttribute(k,v);g.appendChild(strike);}
    });return g;
  }
  async function bake(doc,page,a,vp,rotation,cache){
    const key='text-font:'+a.font;
    // These Korean TTFs lose glyphs with fontkit's subset path.
    // Embed each used family once, retaining its original glyph tables.
    if(!cache.has(key)){const f=await load(a.font);doc.registerFontkit(fontkit);cache.set(key,await doc.embedFont(f.bytes,{subset:false}));}
    const font=cache.get(key),sx=a.nw*vp.width/a.textLayout.width,sy=a.nh*vp.height/a.textLayout.height;
    const c=hexToRgb(a.color);
    // Transform the slant in text space before rotating into the source PDF.
    const r=rotation*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r),P=PDFLib;
    const name=page.node.newFontDictionary('Text',font.ref);
    const color=rgb(c.r,c.g,c.b),slant=a.italic?italicSlope:0;
    const ops=[P.pushGraphicsState(),P.setStrokingColor(color),P.setLineWidth(a.fontSize*sy*boldStroke),P.setLineJoin(P.LineJoinStyle.Round),P.beginText(),P.setFillingColor(color),P.setFontAndSize(name,a.fontSize),P.setTextRenderingMode(a.bold?P.TextRenderingMode.FillAndOutline:P.TextRenderingMode.Fill)];
    a.textLayout.lines.forEach((line,i)=>{
      if(!line)return;
      const [x,y]=vp.convertToPdfPoint(a.nx*vp.width,a.ny*vp.height+(a.textLayout.ascent+i*a.textLayout.step)*sy);
      ops.push(P.setTextMatrix(sx*cos,sx*sin,sy*(slant*cos-sin),sy*(slant*sin+cos),x,y),P.showText(font.encodeText(line)));
    });ops.push(P.endText());
    if(a.strike){
      ops.push(P.setLineWidth(a.fontSize*sy*strikeWidth));
      a.textLayout.lines.forEach((line,i)=>{
        if(!line)return;
        const x=a.nx*vp.width,y=a.ny*vp.height+(a.textLayout.ascent+i*a.textLayout.step-a.fontSize*.3)*sy;
        const from=vp.convertToPdfPoint(x,y),to=vp.convertToPdfPoint(x+a.textLayout.widths[i]*sx,y);
        ops.push(P.moveTo(...from),P.lineTo(...to),P.stroke());
      });
    }
    ops.push(P.popGraphicsState());page.pushOperators(...ops);
  }
  return {families,load,clean,layout,svg,bake,boldStroke,strikeWidth};
})();
