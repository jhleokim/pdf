(async()=>{
  const status=document.getElementById('status'),out=document.getElementById('result'),art=document.getElementById('artifacts'),results=[];
  const assert=(ok,m)=>{if(!ok)throw new Error(m);},record=(name,data)=>{results.push({name,data});out.textContent=JSON.stringify(results,null,2);};
  const P=PDFLib,mm=72/25.4;let engine;
  function artifact(bytes,name){const a=document.createElement('a');a.download=name;a.textContent=name;a.href='data:application/pdf;base64,'+btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));art.append(a);}
  async function render(bytes,num=1){const task=pdfjsLib.getDocument({data:bytes.slice(),isEvalSupported:false});try{const pdf=await task.promise,p=await pdf.getPage(num),vp=p.getViewport({scale:1}),c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);await p.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;return c;}finally{await task.destroy();}}
  try{
    status.textContent='Create synthetic scan';
    const c=document.createElement('canvas');c.width=1400;c.height=1800;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#202124';ctx.font='42px "Malgun Gothic",sans-serif';
    ['PDF STUDIO OCR TEST','문서의 모습은 그대로 유지합니다.','검색과 복사를 할 수 있는 문서입니다.','계약 금액 123,450원','This page contains searchable text.'].forEach((t,i)=>ctx.fillText(t,100,220+i*150));
    engine=await PDFOCR.session('kor+eng',new AbortController().signal,m=>{status.textContent=JSON.stringify(m);});
    const result=await engine.recognize(c);await engine.close();engine=null;
    assert(result.text.includes('검색과 복사를 할 수 있는 문서입니다.')&&result.text.includes('문서')&&result.text.includes('123,450')&&result.text.includes('PDF STUDIO'),'Real Korean/Latin OCR failed: '+result.text);
    record('Offline Korean and English OCR',{text:result.text,confidence:result.confidence,words:result.words.length});
    const doc=await P.PDFDocument.create(),image=await doc.embedPng(c.toDataURL());doc.addPage([595.28,765.36]).drawImage(image,{x:0,y:0,width:595.28,height:765.36});
    const before=await doc.save(),copy=await P.PDFDocument.load(before);await PDFOCR.apply(copy,[{...result,uid:'one'}],{pageIds:['one']});const after=await copy.save();
    const a=await render(before),b=await render(after),ap=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bp=b.getContext('2d').getImageData(0,0,b.width,b.height).data;
    assert(ap.every((v,i)=>v===bp[i]),'OCR changed visible pixels');record('OCR preserves all rendered pixels',ap.length/4);
    const parsed=await pdfjsLib.getDocument({data:after.slice(),isEvalSupported:false}).promise;const text=(await(await parsed.getPage(1)).getTextContent()).items.map(x=>x.str).join('');await parsed.destroy();assert(text.includes('모습은')&&text.includes('유지합니다')&&text.includes('문서')&&text.includes('123,450'),'OCR PDF search extraction failed');record('Searchable PDF Unicode extraction',text);artifact(before,'scan-original.pdf');artifact(after,'scan-searchable.pdf');art.append(b);
    const stamp=document.createElement('canvas');stamp.width=160;stamp.height=160;const sc=stamp.getContext('2d');sc.strokeStyle='#b21f2d';sc.lineWidth=15;sc.strokeRect(10,10,140,140);const data=stamp.toDataURL();
    const geo=await P.PDFDocument.create();for(let i=0;i<4;i++){const page=geo.addPage([400,600]);page.setMediaBox(-20,40,400,600);page.setCropBox(5,65,350,535);page.setRotation(P.degrees(i*90));page.node.set(P.PDFName.of('UserUnit'),P.PDFNumber.of(2));page.drawRectangle({x:-20,y:40,width:400,height:600,color:P.rgb(.7,.8,1)});}
    await PDFStamp.apply(geo,[{data,ratio:1,width:30,x:15,y:20,anchor:'bottom-right',scope:'all',targets:[],opacity:1}],{pageIds:['a','b','c','d']});
    const stamped=await geo.save();for(let i=0;i<4;i++){
      const canvas=await render(stamped,i+1),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const k=(y*canvas.width+x)*4;if(pixels[k]>130&&pixels[k+1]<100&&pixels[k+2]<100){minX=Math.min(x,minX);minY=Math.min(y,minY);maxX=Math.max(x,maxX);maxY=Math.max(y,maxY);}}
      assert(maxX>=0,'Stamp missing at rotation '+i*90);const expected=PDFStamp.placement({ratio:1,width:30,x:15,y:20,anchor:'bottom-right'},canvas.width*2,canvas.height*2);
      assert(Math.abs(minX-expected.x/2)<3&&Math.abs(minY-expected.y/2)<3,'Wrong stamp position at rotation '+i*90);
      const center=((Math.round((minY+maxY)/2)*canvas.width)+Math.round((minX+maxX)/2))*4;assert(pixels[center+2]>240,'Transparent center removed document');
    }
    record('Four rotations, CropBox offsets, UserUnit and transparent stamp center','PASS');artifact(stamped,'stamp-rotations.pdf');
    const options={optimize:true,rasterize:true,maxDimension:1200,jpegQuality:.5,whitePoint:255,contrast:0,paper:'original',stamps:[{data,ratio:1,width:30,x:15,y:20,anchor:'bottom-right',scope:'all',targets:[],opacity:1}],ocr:[{...result,uid:'one'}]};
    const mixed=await PDFProPipeline.apply(await P.PDFDocument.load(before),options,{pageIds:['one']});assert(mixed.report.ocr.pages===1&&mixed.report.stamps===1,'Compression discarded tools');artifact(await mixed.doc.save(),'compressed-ocr-stamp.pdf');record('Raster compression keeps explicitly added OCR and stamp','PASS');
    status.textContent='PASS · '+results.length+' browser checks';
  }catch(e){status.textContent='FAIL · '+e.message;console.error(e);}
  finally{await engine?.close();}
})();
