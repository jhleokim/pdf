async function setupDirectDocument(){
  setProMode('basic');
  const doc=await PDFDocument.create(),fontData=await PDFMarkupText.load('gothic');doc.registerFontkit(fontkit);
  const font=await doc.embedFont(fontData.bytes,{subset:false}),pg=doc.addPage([595,842]);
  pg.drawText('DOCUMENT REVIEW',{x:54,y:774,size:9,font,color:rgb(.38,.42,.42)});
  pg.drawText('업무 프로세스 검토',{x:54,y:726,size:26,font,color:rgb(.12,.15,.15)});
  pg.drawText('검토 자료 · 2026. 09. 09.',{x:54,y:696,size:11,font,color:rgb(.45,.48,.48)});
  pg.drawLine({start:{x:54,y:670},end:{x:541,y:670},thickness:.7,color:rgb(.78,.8,.8)});
  pg.drawText('01   검토 의견',{x:54,y:628,size:15,font,color:rgb(.05,.4,.37)});
  const lines=['문서 편집은 내용을 읽는 흐름 안에서 이루어져야 합니다.','필요한 문장에 표시하고, 의견은 해당 위치에 남깁니다.','화면보다 문서에 집중할 수 있는 간결한 작업 방식입니다.'];
  lines.forEach((line,i)=>pg.drawText(line,{x:54,y:591-i*27,size:13,font,color:rgb(.19,.22,.22)}));
  pg.drawText('02   확인 사항',{x:54,y:453,size:15,font,color:rgb(.05,.4,.37)});
  ['검토 범위와 담당자를 확인했습니다.','최종 의견은 아래 여백에 작성해 주세요.'].forEach((line,i)=>pg.drawText(line,{x:54,y:416-i*27,size:13,font,color:rgb(.19,.22,.22)}));
  pg.drawLine({start:{x:54,y:180},end:{x:541,y:180},thickness:.7,color:rgb(.86,.87,.87)});
  pg.drawText('PDF Studio',{x:54,y:150,size:9,font,color:rgb(.5,.53,.53)});
  pg.drawText('1',{x:530,y:150,size:9,font,color:rgb(.5,.53,.53)});
  await loadFiles([new File([await doc.save()],'업무 프로세스 검토.pdf',{type:'application/pdf'})]);
  if(innerWidth<=880)setMobileView('preview');await showPreview(pages[0]);
}
