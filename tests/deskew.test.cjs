const test=require('node:test'),assert=require('node:assert/strict');
const deskew=require('../src/pro-deskew.js');
function raster(angle,kind='text'){
 const width=800,height=1000,data=new Uint8ClampedArray(width*height*4).fill(255),s=Math.tan(angle*Math.PI/180);
 if(kind==='blank')return {data,width,height};
 let seed=123;
 for(let y=50;y<950;y++)for(let x=50;x<750;x++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const row=y-s*(x-400),line=Math.floor((row-100)/34),ink=line>=0&&line<23&&(row-100)%34>=0&&(row-100)%34<11&&(x+line*7)%13<8&&x<700-line%4*50;
  if(kind==='noise'?seed%5===0:ink){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=20;}
 }
 return {data,width,height};
}
test('offline deskew finds both tilt directions and leaves level/blank/noise pages unchanged',()=>{
 for(const angle of [-5,-3,2,4.5]){const r=deskew.detect(raster(angle));assert.ok(Math.abs(r.angle-angle)<=.2,JSON.stringify({angle,r}));}
 for(const kind of ['text','blank','noise'])assert.equal(deskew.detect(raster(0,kind)).angle,0,kind);
});
test('deskew expands offset bounds for every corner without shrinking or changing distance',()=>{
 const box={x:32,y:-17,width:600,height:800};
 for(const angle of [-60,-45,-7,-3,0,3,7,45,60]){
  const {matrix:[a,b,c,d,e,f],bounds}=deskew.geometry(box,angle);
  assert.ok(Math.abs(a*a+b*b-1)<1e-12,'Original text and image scale must be retained');
  assert.ok(Math.abs(a*d-b*c-1)<1e-12,'Original area must be retained');
  for(const x of [box.x,box.x+box.width])for(const y of [box.y,box.y+box.height]){
   const xx=a*x+c*y+e,yy=b*x+d*y+f;
   assert.ok(xx>=bounds.x-1e-8&&xx<=bounds.x+bounds.width+1e-8);
   assert.ok(yy>=bounds.y-1e-8&&yy<=bounds.y+bounds.height+1e-8);
  }
 }
 for(const angle of [-60.1,60.1,NaN,Infinity,'2'])assert.throws(()=>deskew.geometry(box,angle),/60/);
});

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),child=require('node:child_process'),os=require('node:os');
const root=path.resolve(__dirname,'..'),scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const ctx=vm.createContext({console:{log(){},warn(){},error:console.error},setTimeout,clearTimeout,TextEncoder,TextDecoder,URL,URLSearchParams,Blob,ReadableStream,WritableStream,TransformStream,AbortController,AbortSignal,atob,btoa,DOMException,ArrayBuffer,Uint8Array,Uint8ClampedArray,Int8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,DataView,assert});
for(const marker of ['sourceMappingURL=pdf-lib.min.js.map','pdfjs-dist/build/pdf"]','pdfjs-dist/build/pdf.worker'])vm.runInContext(scripts.find(s=>s.includes(marker)),ctx);
for(const name of ['pro-engine','pro-document','pro-deskew','pro-ocr','pro-pipeline'])vm.runInContext(fs.readFileSync(path.join(root,'src',name+'.js'),'utf8'),ctx);
const run=code=>vm.runInContext(code,ctx);
run(`
async function fixture({angle=0,userUnit=1,annot=false}={}){
 const P=PDFLib,doc=await P.PDFDocument.create(),font=await doc.embedFont(P.StandardFonts.Helvetica),page=doc.addPage([400,600]);
 page.setMediaBox(-20,40,400,600);page.setCropBox(5,65,350,535);page.setRotation(P.degrees(angle));
 page.node.set(P.PDFName.of('UserUnit'),P.PDFNumber.of(userUnit));
 for(const [x,y,color]of[[7,67,[1,0,0]],[341,67,[0,1,0]],[7,586,[0,0,1]],[341,586,[1,0,1]]])page.drawRectangle({x,y,width:12,height:12,color:P.rgb(...color)});
 page.drawRectangle({x:-18,y:100,width:20,height:100,color:P.rgb(1,1,0)});
 for(const [text,x,y]of[['TOP EDGE TEXT',25,588],['BOTTOM EDGE TEXT',25,68],['LEFT',6,330],['RIGHT',320,330]])page.drawText(text,{x,y,size:8,font});
 page.drawText('HIDDEN OCR 123.45',{x:45,y:500,size:12,font,opacity:0});
 if(annot){const field=doc.getForm().createTextField('original');field.setText('Preserved value');field.addToPage(page,{x:50,y:250,width:160,height:20});}
 return doc;
}
async function extract(bytes){const task=pdfjsLib.getDocument({data:bytes.slice(),isEvalSupported:false});try{const pdf=await task.promise;return(await(await pdf.getPage(1)).getTextContent()).items.map(t=>t.str).filter(Boolean).join('|');}finally{await task.destroy();}}
`);

test('manual rotations retain vectors, searchable text, original rotation and physical units on offset cropped pages',async()=>{
 await run(`(async()=>{
  for(const rotation of [0,90,180,270])for(const angle of [-60,60]){
   const doc=await fixture({angle:rotation,userUnit:2}),page=doc.getPage(0),before=await extract(await doc.save()),bounds=PDFDeskew.geometry(PDFProDocument.visibleBox(page),-angle).bounds;
   const report=await PDFDeskew.processDocument(doc,{deskew:true,deskewAngles:{chosen:angle}},{pageIds:['chosen'],pageOffset:4});
   assert.equal(report.changed,1);assert.equal(report.pages[0].page,5);assert.equal(report.pages[0].pageId,'chosen');assert.equal(report.pages[0].angle,-angle);assert.equal(report.pages[0].displayAngle,angle);
   const output=await doc.save(),copy=await PDFLib.PDFDocument.load(output),p=copy.getPage(0);
   assert.equal(await extract(output),before);assert.equal(p.getRotation().angle,rotation);assert.equal(PDFProDocument.unit(p),2);
   for(const get of ['getMediaBox','getCropBox','getTrimBox','getBleedBox','getArtBox'])for(const key of ['x','y','width','height'])assert.ok(Math.abs(p[get]()[key]-bounds[key])<1e-8);
   assert.equal(copy.context.enumerateIndirectObjects().filter(([,o])=>o.dict?.get(PDFLib.PDFName.of('Subtype'))?.toString()==='/Image').length,0,'Vector text was rasterized');
  }
 })()`);
});

test('manual UID angles follow reordering; manual zero and unmatched UID never invoke raster detection',async()=>{
 await run(`(async()=>{
  const doc=await PDFLib.PDFDocument.create();doc.addPage([300,500]);doc.addPage([300,500]);doc.addPage([300,500]);
  const original=pdfjsLib;globalThis.pdfjsLib={getDocument(){throw Error('Manual path must not render');}};
  try{
   const report=await PDFDeskew.processDocument(doc,{deskew:false,deskewAngles:{b:15,a:0,other:30}},{pageIds:['b','a','c']});
   assert.equal(report.changed,1);assert.equal(report.pages[0].displayAngle,15);assert.equal(report.pages[1].mode,'manual');assert.equal(report.pages[1].angle,0);assert.equal(report.pages[2].mode,'off');
   assert.equal(doc.getPage(1).getWidth(),300);assert.equal(doc.getPage(2).getWidth(),300);
   const zero=await fixture();assert.equal((await PDFDeskew.processDocument(zero,{deskew:true,deskewAngles:{a:0}},{pageIds:['a']})).changed,0);
   const noIds=await fixture();assert.equal((await PDFDeskew.processDocument(noIds,{deskew:false,deskewAngles:{0:15,1:30}},{pageOffset:0})).changed,0);
  }finally{globalThis.pdfjsLib=original;}
 })()`);
});

test('invalid angles and manual annotation rotation fail before mutation; auto leaves forms intact with reason',async()=>{
 await run(`(async()=>{
  const doc=await fixture({annot:true}),before=doc.getPage(0).node.toString();
  await assert.rejects(PDFDeskew.processDocument(doc,{deskewAngles:{a:10}},{pageIds:['a']}),/링크·주석·양식/);
  assert.equal(doc.getPage(0).node.toString(),before);
  for(const angle of [-61,61,NaN,Infinity,'5'])await assert.rejects(PDFDeskew.processDocument(doc,{deskewAngles:{a:angle}},{pageIds:['a']}),/60/);
  const report=await PDFDeskew.processDocument(doc,{deskew:true},{pageIds:['a']});assert.equal(report.changed,0);assert.equal(report.pages[0].angle,0);assert.match(report.pages[0].reason,/링크·주석·양식/);
  const copy=await PDFLib.PDFDocument.load(await doc.save());assert.equal(copy.getForm().getTextField('original').getText(),'Preserved value');
  const zero=await PDFDeskew.processDocument(doc,{deskew:true,deskewAngles:{a:0}},{pageIds:['a']});assert.equal(zero.changed,0);
  const two=await PDFLib.PDFDocument.create();two.addPage([300,400]);two.addPage([300,400]);
  await assert.rejects(PDFDeskew.processDocument(two,{deskewAngles:{a:10,b:61}},{pageIds:['a','b']}),/60/);assert.equal(two.getPage(0).getWidth(),300);
 })()`);
});

test('manual selected-page preview has the same geometry and content transform as full export',async()=>{
 await run(`(async()=>{
  const source=await fixture({angle:270}),full=await PDFLib.PDFDocument.create();full.addPage([200,300]);full.addPage((await full.copyPages(source,[0]))[0]);
  const preview=await PDFLib.PDFDocument.create();preview.addPage((await preview.copyPages(source,[0]))[0]);
  const options={deskew:false,deskewAngles:{target:-33.5}};
  await PDFDeskew.processDocument(full,options,{pageIds:['other','target']});await PDFDeskew.processDocument(preview,options,{pageIds:['target'],pageOffset:1});
  const a=full.getPage(1),b=preview.getPage(0);assert.deepEqual(a.getCropBox(),b.getCropBox());assert.equal(a.getRotation().angle,b.getRotation().angle);
  const operators=p=>p.node.Contents().asArray().map(ref=>p.doc.context.lookup(ref)).filter(s=>s.getContentsString).map(s=>s.getContentsString()).join('');
  assert.equal(operators(a),operators(b));
  const stopped=new AbortController();stopped.abort();await assert.rejects(PDFDeskew.processDocument(preview,options,{pageIds:['target'],signal:stopped.signal}),e=>e.name==='AbortError');
 })()`);
});

test('auto measurements reuse bounded UID content-key cache and never cache aborted or invalid results',async()=>{
 ctx.deskewRaster=raster(3);
 await run(`(async()=>{
  const original=pdfjsLib,priorDocument=globalThis.document;let renders=0,abortDuringRender;
  globalThis.document={createElement(){return{width:0,height:0,getContext(){return{getImageData(){return deskewRaster;}};}};}};
  globalThis.pdfjsLib={getDocument(){return{promise:Promise.resolve({getPage:async()=>({getViewport(){return{width:800,height:1000};},render(){renders++;abortDuringRender?.abort();return{promise:Promise.resolve(),cancel(){}};},cleanup(){}})}),async destroy(){}};}};
  const fresh=async()=>{const d=await PDFLib.PDFDocument.create();d.addPage([800,1000]);return d;},cache=new Map(),callbacks={pageIds:['uid'],deskewKeys:['uid:original'],deskewCache:cache};
  try{
   const first=await PDFDeskew.processDocument(await fresh(),{deskew:true},callbacks),second=await PDFDeskew.processDocument(await fresh(),{deskew:true},callbacks);
   assert.equal(renders,1);assert.equal(first.pages[0].angle,second.pages[0].angle);assert.equal(first.changed,1);assert.equal(cache.size,1);
   assert.deepEqual(Object.keys(cache.get('uid:original')).sort(),['angle','confidence','reason']);
   cache.set('uid:original',{angle:60,reason:''});await PDFDeskew.processDocument(await fresh(),{deskew:true},callbacks);assert.equal(renders,2,'Manual-range angles must not be accepted as cached automatic detections');
   for(let i=0;i<128;i++)cache.set('old:'+i,{angle:0,reason:'level'});
   await PDFDeskew.processDocument(await fresh(),{deskew:true},{...callbacks,deskewKeys:['new:key']});assert.equal(cache.size,128);assert.ok(!cache.has('old:0'));
   abortDuringRender=new AbortController();await assert.rejects(PDFDeskew.processDocument(await fresh(),{deskew:true},{...callbacks,deskewKeys:['abort:key'],signal:abortDuringRender.signal}),e=>e.name==='AbortError');assert.ok(!cache.has('abort:key'));
  }finally{globalThis.pdfjsLib=original;globalThis.document=priorDocument;}
 })()`);
});

function ppm(bytes){
 let offset=0;const token=()=>{while(bytes[offset]<=32)offset++;let start=offset;while(bytes[offset]>32)offset++;return bytes.subarray(start,offset).toString();};
 assert.equal(token(),'P6');const width=+token(),height=+token();assert.equal(+token(),255);offset++;return{width,height,data:bytes.subarray(offset)};
}
function colorCounts({data},stride=3){
 const n={red:0,green:0,blue:0,magenta:0,yellow:0};
 for(let i=0;i<data.length;i+=stride){const[r,g,b]=data.subarray(i,i+3);if(r>200&&g<40&&b<40)n.red++;if(r<40&&g>200&&b<40)n.green++;if(r<40&&g<40&&b>200)n.blue++;if(r>200&&g<40&&b>200)n.magenta++;if(r>200&&g>200&&b<40)n.yellow++;}return n;
}
const canvasModule=(()=>{
 for(const name of ['@napi-rs/canvas',process.env.PDF_DESKEW_CANVAS_MODULE,path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','@napi-rs','canvas')].filter(Boolean))try{return require(name);}catch{}
 return null;
})();
test('bundled PDF.js preserves the four rotated clipping corners, including automatic-range angles and A4 fitting',{skip:canvasModule?false:'@napi-rs/canvas is not installed'},async()=>{
 const prior={document:ctx.document,DOMMatrix:ctx.DOMMatrix,Path2D:ctx.Path2D,ImageData:ctx.ImageData};
 Object.assign(ctx,{DOMMatrix:canvasModule.DOMMatrix,Path2D:canvasModule.Path2D,ImageData:canvasModule.ImageData,document:{createElement(){return canvasModule.createCanvas(1,1);}},makeDeskewCanvas:canvasModule.createCanvas,deskewCornerCounts:canvas=>colorCounts(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),4)});
 try{await run(`(async()=>{
  for(const rotation of [0,90,180,270])for(const angle of [-60,-3,3,60])for(const a4 of [false,true]){
   const doc=await fixture({angle:rotation});PDFDeskew.apply(doc.getPage(0),angle);
   if(a4)await PDFProDocument.applyDocument(doc,{crop:false,paper:'a4',number:false,watermark:''});
   const task=pdfjsLib.getDocument({data:await doc.save(),disableFontFace:true,isEvalSupported:false,verbosity:0});
   try{const pdf=await task.promise,p=await pdf.getPage(1),vp=p.getViewport({scale:1}),c=makeDeskewCanvas(Math.ceil(vp.width),Math.ceil(vp.height));
    await p.render({canvasContext:c.getContext('2d'),viewport:vp,background:'white'}).promise;
    const counts=deskewCornerCounts(c);
    for(const color of ['red','green','blue','magenta'])assert.ok(counts[color]>=115,JSON.stringify({rotation,angle,a4,color,counts}));
    assert.equal(counts.yellow,0,'PDF.js must retain the original crop rather than expose hidden content');
   }finally{await task.destroy();}
  }
 })()`);}finally{Object.assign(ctx,prior);delete ctx.makeDeskewCanvas;delete ctx.deskewCornerCounts;}
});
const poppler=child.spawnSync('pdftoppm',['-v'],{encoding:'utf8',windowsHide:true});
test('full pipeline A4 fitting, page numbers and added OCR retain every edge after manual ±60° rotation',{skip:poppler.error?'pdftoppm is not installed':false},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdf-deskew-a4-'));
 try{
  const {sourceBytes,outputBytes}=await run(`(async()=>{
   const P=PDFLib,source=await P.PDFDocument.create(),ids=[],angles={};
   for(const rotation of [0,90,180,270])for(const angle of [-60,60]){
    const uid='edge-'+ids.length;ids.push(uid);angles[uid]=angle;
    const d=await fixture({angle:rotation,userUnit:2});source.addPage((await source.copyPages(d,[0]))[0]);
   }
   const sourceBytes=await source.save(),input=await P.PDFDocument.load(sourceBytes);
   const options={deskew:false,deskewAngles:angles,optimize:false,rasterize:false,paper:'a4',crop:false,margins:[0,0,0,0],number:true,startNumber:101,skipPages:0,numberPosition:'bottom-center',watermark:'',ocr:ids.map(uid=>({uid,words:[{text:'ADDED OCR SEARCH 987.65',box:[.2,.2,.6,.23]}]}))};
   const processed=await PDFProPipeline.apply(input,options,{pageIds:ids});
   assert.equal(processed.report.deskew.changed,8);assert.equal(processed.report.ocr.pages,8);
   const outputBytes=await processed.doc.save(),pdf=await pdfjsLib.getDocument({data:outputBytes.slice(),isEvalSupported:false}).promise;
   try{for(let i=0;i<ids.length;i++){
    const p=processed.doc.getPage(i),box=p.getCropBox();assert.equal(PDFProDocument.unit(p),1);
    assert.ok(Math.abs(Math.max(box.width,box.height)-297*72/25.4)<1e-6);assert.ok(Math.abs(Math.min(box.width,box.height)-210*72/25.4)<1e-6);
    const text=(await(await pdf.getPage(i+1)).getTextContent()).items.map(t=>t.str).join('');
    for(const phrase of ['TOP EDGE TEXT','BOTTOM EDGE TEXT','LEFT','RIGHT','HIDDEN OCR 123.45','ADDED OCR SEARCH 987.65',String(101+i)])assert.ok(text.includes(phrase),phrase+' absent on '+i+': '+text);
   }}finally{await pdf.destroy();}
   return{sourceBytes,outputBytes};
  })()`);
  const input=path.join(dir,'pipeline.pdf'),output=path.join(dir,'render');fs.writeFileSync(input,Buffer.from(outputBytes));
  for(let page=1;page<=8;page++){
   child.execFileSync('pdftoppm',['-r','72','-f',String(page),'-singlefile','-cropbox',input,output],{windowsHide:true,stdio:'pipe'});
   const counts=colorCounts(ppm(fs.readFileSync(output+'.ppm')));
   for(const color of ['red','green','blue','magenta'])assert.ok(counts[color]>=115,JSON.stringify({page,color,counts}));
   assert.equal(counts.yellow,0,'A4 after deskew must not reveal previously cropped-out content');
  }
  // Optional local browser fixtures; excluded from commits by the caller's QA path.
  if(process.env.PDF_DESKEW_QA_DIR){const qa=path.resolve(root,process.env.PDF_DESKEW_QA_DIR);fs.mkdirSync(qa,{recursive:true});fs.writeFileSync(path.join(qa,'deskew-edge-source.pdf'),Buffer.from(sourceBytes));fs.writeFileSync(path.join(qa,'deskew-a4-output.pdf'),Buffer.from(outputBytes));}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('rendered corners remain visible at ±60°, all /Rotate values; existing cropped-out content remains hidden',{skip:poppler.error?'pdftoppm is not installed':false},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdf-deskew-'));
 try{
  for(const rotation of [0,90,180,270])for(const angle of [-60,60]){
   const bytes=await run(`(async()=>{const d=await fixture({angle:${rotation}});PDFDeskew.apply(d.getPage(0),${angle});return d.save();})()`);
   const input=path.join(dir,'case.pdf'),output=path.join(dir,'render');fs.writeFileSync(input,Buffer.from(bytes));
   child.execFileSync('pdftoppm',['-r','72','-singlefile','-cropbox',input,output],{windowsHide:true,stdio:'pipe'});
   const counts=colorCounts(ppm(fs.readFileSync(output+'.ppm')));
   for(const color of ['red','green','blue','magenta'])assert.ok(counts[color]>=115,JSON.stringify({rotation,angle,color,counts}));
   assert.equal(counts.yellow,0,'Rotating an existing CropBox must not reveal hidden source content');
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
