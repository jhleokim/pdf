/* Browser integration checks: actual codecs, PDF rendering, geometry and OCR. */
(async()=>{
 const P=PDFLib,out=document.getElementById('result'),art=document.getElementById('artifacts'),results=[];
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const record=(name,detail)=>{results.push({name,detail});out.textContent=JSON.stringify(results,null,2);};
 const defaults={optimize:false,grayscale:false,contrast:0,whitePoint:255,deskew:false,crop:false,margins:[0,0,0,0],paper:'original',number:false,watermark:'',startNumber:7,skipPages:0,numberPosition:'bottom-center'};
 const png=canvas=>new Promise(r=>canvas.toBlob(async b=>r(new Uint8Array(await b.arrayBuffer())),'image/png'));
 const jpeg=canvas=>new Promise(r=>canvas.toBlob(async b=>r(new Uint8Array(await b.arrayBuffer())),'image/jpeg',.98));
 function download(bytes,name){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));a.download=name;a.textContent=name;art.append(a);}
 async function render(bytes,index=1){
  const pdf=await pdfjsLib.getDocument({data:bytes.slice()}).promise;
  try{
   const p=await pdf.getPage(index),base=p.getViewport({scale:1}),v=p.getViewport({scale:1200/Math.max(base.width,base.height)});
   const c=document.createElement('canvas');c.width=Math.ceil(v.width);c.height=Math.ceil(v.height);
   await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;return c;
  }finally{await pdf.destroy();}
 }
 async function texts(bytes){const pdf=await pdfjsLib.getDocument({data:bytes.slice()}).promise;try{const a=[];for(let i=1;i<=pdf.numPages;i++)a.push((await(await pdf.getPage(i)).getTextContent()).items.map(t=>t.str).join(''));return a;}finally{await pdf.destroy();}}
 const pixel=(canvas,x,y)=>[...canvas.getContext('2d').getImageData(x,y,1,1).data].slice(0,3);
 const detect=canvas=>PDFDeskew.detect(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height));
 try{
  const source=await P.PDFDocument.create(),font=await source.embedFont(P.StandardFonts.Helvetica);
  for(const angle of [3,-4,0]){
   const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=2400;
   const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,1800,2400);
   c.save();c.translate(900,1200);c.rotate(angle*Math.PI/180);c.translate(-900,-1200);
   c.fillStyle='#111';c.font='30px Arial';
   for(let n=0;n<28;n++)c.fillText(`Document sample ${n+1}: searchable text and scan alignment verification.`,180,240+n*66);
   c.restore();
   const page=source.addPage([600,800]),im=await source.embedJpg(await jpeg(canvas));page.drawImage(im,{x:0,y:0,width:600,height:800});
   const a=angle*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a);
   page.pushOperators(P.pushGraphicsState(),P.concatTransformationMatrix(cos,-sin,sin,cos,300-cos*300-sin*400,400+sin*300-cos*400));
   page.drawText('SEARCHABLE OCR PRESERVED',{x:60,y:720,size:10,font,opacity:0});page.pushOperators(P.popGraphicsState());page.resetPosition();
  }
  const bytes=await source.save(),doc=await P.PDFDocument.load(bytes);
  download(bytes,'deskew-fixture.pdf');
  const report=await PDFDeskew.processDocument(doc,{...defaults,deskew:true});
  assert(report.changed===2,'Expected two corrected pages: '+JSON.stringify(report));
  const corrected=await doc.save();download(corrected,'deskew-corrected.pdf');
  const beforeText=await texts(bytes),afterText=await texts(corrected);
  assert(JSON.stringify(beforeText)===JSON.stringify(afterText),'Deskew changed hidden OCR text');
  for(let n=1;n<=3;n++){
   const before=await render(bytes,n),after=await render(corrected,n),residual=detect(after);art.append(before,after);
   assert(residual.angle===0,'Correction sign/residual is wrong: '+JSON.stringify(residual));
   record('deskew page '+n,{before:detect(before),correction:report.pages[n-1],residual});
  }
  const rotated=await P.PDFDocument.load(bytes);rotated.getPage(0).setRotation(P.degrees(90));
  // A sideways sheet is intentionally left unchanged (this is not orientation OCR).
  const rotatedReport=await PDFDeskew.processDocument(rotated,{...defaults,deskew:true});
  assert(!rotatedReport.pages[0].angle,'Sideways text must not be guessed as horizontal');
  const annotations=await P.PDFDocument.load(bytes),p=annotations.getPage(0);
  p.node.set(P.PDFName.of('Annots'),annotations.context.obj([annotations.context.register(annotations.context.obj({Type:'Annot',Subtype:'Link',Rect:[30,30,100,60]}))]));
  const guarded=await PDFDeskew.processDocument(annotations,{...defaults,deskew:true});assert(!guarded.pages[0].angle,'Link coordinates must be preserved');
  const abort=new AbortController();abort.abort();let cancelled=false;
  try{await PDFDeskew.processDocument(doc,{deskew:true},{signal:abort.signal});}catch(e){cancelled=e.name==='AbortError';}assert(cancelled,'Pre-aborted deskew must cancel');
  record('sideways / annotation guard / cancellation','pass');
  const imageDoc=await P.PDFDocument.create(),canvas=document.createElement('canvas');canvas.width=1800;canvas.height=2400;
  const c=canvas.getContext('2d');c.fillStyle='rgb(230,230,230)';c.fillRect(0,0,1800,2400);c.fillStyle='rgb(160,90,50)';c.fillRect(0,0,900,1200);
  c.fillStyle='#333';c.font='40px Arial';for(let n=0;n<22;n++)c.fillText('Document quality test '+n,950,100+n*90);
  const jpg=await jpeg(canvas);
  const img=await imageDoc.embedJpg(jpg);imageDoc.addPage([600,800]).drawImage(img,{x:0,y:0,width:600,height:800});
  const imageBytes=await imageDoc.save(),base=await render(imageBytes),baseDark=pixel(base,100,100),baseLight=pixel(base,100,900);
  for(const [name,extra] of [['grayscale',{grayscale:true}],['contrast',{contrast:40}],['white point',{whitePoint:220}],['optimize',{optimize:true,maxDimension:1600,jpegQuality:.65}]]){
   const d=await P.PDFDocument.load(imageBytes),r=await PDFPro.processDocument(d,{...defaults,...extra}),b=await d.save(),rendered=await render(b),dark=pixel(rendered,100,100),light=pixel(rendered,100,900);
   assert(r.changed===1,name+' did not change image: '+JSON.stringify(r));
   if(name==='grayscale')assert(Math.max(...dark)-Math.min(...dark)<=2,'Grayscale still colored');
   if(name==='contrast')assert(dark[0]>baseDark[0]+3&&dark[2]<baseDark[2]-3,'Contrast did not expand tonal range');
   if(name==='white point')assert(light.every(n=>n>=253)&&baseLight[0]<240,'Background cleanup did not whiten');
   if(name==='optimize')assert(b.length<imageBytes.length*.8,'Optimization did not reduce test scan');
   record(name,{before:baseDark,after:dark,background:light,beforeBytes:imageBytes.length,afterBytes:b.length});
  }
  const combined=await P.PDFDocument.load(bytes),opts={...defaults,deskew:true,number:true,skipPages:1,watermark:'검토용',paper:'a4',crop:true,margins:[5,5,5,5]};
  await PDFDeskew.processDocument(combined,opts);await PDFProDocument.applyDocument(combined,opts);
  const combinedBytes=await combined.save(),combinedText=await texts(combinedBytes);
  assert(!combinedText[0].endsWith('7')&&combinedText[1].endsWith('7')&&combinedText[2].endsWith('8'),'Numbering cover/start mismatch');
  assert(combinedText.every((t,i)=>t.includes(beforeText[i])),'Combined export lost OCR');
  assert(Math.abs(combined.getPage(0).getWidth()-210*72/25.4)<1e-6,'A4 width incorrect');
  const one=await P.PDFDocument.create();one.addPage((await one.copyPages(await P.PDFDocument.load(bytes),[1]))[0]);
  const preview=await P.PDFDocument.load(await one.save());await PDFDeskew.processDocument(preview,opts,{pageOffset:1});await PDFProDocument.applyDocument(preview,opts,{pageOffset:1});
  const previewRender=await render(await preview.save()),exportRender=await render(combinedBytes,2);
  const pa=previewRender.getContext('2d').getImageData(0,0,previewRender.width,previewRender.height).data,ea=exportRender.getContext('2d').getImageData(0,0,exportRender.width,exportRender.height).data;
  assert(pa.length===ea.length&&pa.every((n,i)=>n===ea[i]),'Selected-page preview differs from full export');
  download(combinedBytes,'pro-combined-result.pdf');art.append(exportRender);
  const markDoc=await P.PDFDocument.create();markDoc.addPage([600,800]);await PDFProDocument.applyDocument(markDoc,{...defaults,watermark:'검토용'});
  const markCanvas=await render(await markDoc.save()),pixels=markCanvas.getContext('2d').getImageData(0,0,markCanvas.width,markCanvas.height).data;
  assert(pixels.some((n,i)=>i%4!==3&&n<250),'Korean watermark not visible');
  record('crop / A4 / cover exclusion / Korean watermark / preview = export',{ocr:combinedText,previewMatches:true});

  // Regression for missing regions: embedded PNG transparency is a separate
  // DeviceGray image referenced by SMask, not a regular color image.
  const maskDoc=await P.PDFDocument.create(),maskCanvas=document.createElement('canvas');maskCanvas.width=500;maskCanvas.height=500;
  const mc=maskCanvas.getContext('2d');mc.fillStyle='rgba(210,25,40,.7)';mc.fillRect(40,40,420,420);mc.clearRect(150,150,200,200);
  const masked=await maskDoc.embedPng(await png(maskCanvas)),mp=maskDoc.addPage([600,800]);mp.drawImage(masked,{x:50,y:250,width:500,height:500});mp.drawText('MASK REGION MUST SURVIVE',{x:50,y:150,size:22});
  const maskBytes=await maskDoc.save(),maskLoaded=await P.PDFDocument.load(maskBytes),maskBefore=await render(maskBytes);
  const mr=await PDFPro.processDocument(maskLoaded,{...defaults,optimize:true,blackWhite:true});
  const maskAfter=await render(await maskLoaded.save()),mbp=maskBefore.getContext('2d').getImageData(0,0,maskBefore.width,maskBefore.height).data,map=maskAfter.getContext('2d').getImageData(0,0,maskAfter.width,maskAfter.height).data;
  assert(mbp.length===map.length&&mbp.every((n,i)=>n===map[i]),'Transparent page region disappeared or changed');
  assert(mr.skipReasons.maskSource===1,'Soft mask was not protected');download(maskBytes,'mask-fixture.pdf');art.append(maskBefore,maskAfter);record('transparent region preservation',{pixelIdentical:true,report:mr});
  const bw=await PDFProPipeline.apply(await P.PDFDocument.load(bytes),{...defaults,optimize:true,maxDimension:2400,jpegQuality:.82,blackWhite:true,bwThreshold:180});
  const bwBytes=await bw.doc.save(),bwCanvas=await render(bwBytes);art.append(bwCanvas);download(bwBytes,'bw-text-preserved.pdf');
  assert(JSON.stringify(await texts(bwBytes))===JSON.stringify(beforeText),'B&W changed OCR');
  const bwImages=bw.doc.context.enumerateIndirectObjects().filter(([,o])=>o instanceof P.PDFRawStream&&String(o.dict.get(P.PDFName.of('Subtype')))==='/Image');
  assert(bwImages.every(([,o])=>o.dict.lookup(P.PDFName.of('BitsPerComponent')).asNumber()===1),'B&W was re-encoded as JPEG');
  assert(bwBytes.length<bytes.length*.25,'B&W scan compression too small');record('B&W 1-bit and OCR',{before:bytes.length,after:bwBytes.length});
  for(const blackWhite of [false,true]){
   const settings={...defaults,rasterize:true,optimize:true,maxDimension:1200,jpegQuality:.5,blackWhite,bwThreshold:180};
   const whole=await PDFProPipeline.apply(await P.PDFDocument.load(bytes),settings),wholeBytes=await whole.doc.save();
   assert(whole.doc.getPageCount()===3,'Raster lost pages');assert((await texts(wholeBytes)).every(t=>!t),'Raster output unexpectedly claims preserved text');
   assert(wholeBytes.length<bytes.length*.3,'Whole-page compression failed to reduce large scan');
   const rendered=await render(wholeBytes);art.append(rendered);download(wholeBytes,blackWhite?'whole-bw.pdf':'whole-color.pdf');
   record(blackWhite?'whole-page B&W':'whole-page color',{before:bytes.length,after:wholeBytes.length,pages:3});
  }
  const transparentRaster=await PDFProPipeline.apply(await P.PDFDocument.load(maskBytes),{...defaults,rasterize:true,optimize:true,maxDimension:1200,jpegQuality:.5});
  const trc=await render(await transparentRaster.doc.save());
  const color=pixel(trc,160,160);assert(color[0]>color[1]+60,'Whole-page compression lost transparent color region');record('whole-page transparency rendering',{pixel:color});

  const physical=await P.PDFDocument.create();physical.addPage([300,400]).node.set(P.PDFName.of('UserUnit'),P.PDFNumber.of(2));
  physical.getPage(0).drawText('Physical size',{x:25,y:200,size:20});
  const physicalResult=await PDFProPipeline.apply(await P.PDFDocument.load(await physical.save()),{...defaults,rasterize:true,optimize:true,maxDimension:600,jpegQuality:.5});
  assert(physicalResult.doc.getPage(0).getWidth()===600&&physicalResult.doc.getPage(0).getHeight()===800,'Raster changed physical UserUnit size');
  const stop=new AbortController();stop.abort();let cancelledRaster=false;
  try{await PDFProPipeline.apply(await P.PDFDocument.load(bytes),{...defaults,rasterize:true,optimize:true,maxDimension:1200,jpegQuality:.5},{signal:stop.signal});}catch(e){cancelledRaster=e.name==='AbortError';}
  assert(cancelledRaster,'Raster cancellation failed');record('raster physical size / cancellation','pass');
  out.dataset.state='passed';out.textContent='PASS — '+results.length+' checks\n'+JSON.stringify(results,null,2);
 }catch(e){out.dataset.state='failed';out.textContent+='\nFAIL: '+e.stack;console.error(e);}
})();
