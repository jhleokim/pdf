'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const verify=require('../src/pro-text-verification.js').verify;
const item=(str,x=30,y=50,width=30,height=10)=>({str,width,height,transform:[height,0,0,height,x,y],fontName:'font'});
const content=items=>({items,styles:{font:{ascent:.8,descent:-.2}}});
const report=(extra={})=>({cropped:true,matrix:[1,0,0,1,0,0],cropBounds:{x:0,y:0,width:100,height:100},rotation:0,userUnit:1,...extra});

test('retained body text must survive in order while added marks and changed PDF.js segmentation are allowed',()=>{
 const source=content([item('FIRST BODY',10,30),item('SECOND BODY',10,60)]);
 const output=content([{str:'Page 17 FIRST'},{str:' BODY\n added '},{str:'SECOND BODY footer'}]);
 const good=verify(source,output,report());assert.equal(good.ok,true);assert.equal(good.expectedItems,2);assert.equal(good.characters,19);assert.equal(good.unchecked,false);
 for(const missing of['FIRST BODY','SECOND BODY','SECOND BODY FIRST BODY']){
  const failed=verify(source,content([{str:missing}]),report());assert.equal(failed.ok,false);assert.equal(failed.reason,'missing-retained-text');
 }
});

test('cut and uncertain runs are counted as excluded; no retained text is explicitly unchecked',()=>{
 const outside=item('OUTSIDE',-30,50),boundary=item('PARTLY CUT',-1,50,20),descender=item('DESCENDER',20,.1),vertical={...item('VERTICAL',20,40),dir:'ttb'},body=item('BODY',30,50);
 const result=verify(content([outside,boundary,descender,vertical,body]),content([{str:'BODY'}]),report());
 assert.equal(result.ok,true);assert.equal(result.expectedItems,1);assert.equal(result.excludedItems,4);assert.equal(result.characters,4);assert.ok(result.excludedCharacters>4);
 const empty=verify(content([outside,boundary,vertical]),content([]),report());assert.equal(empty.ok,true);assert.equal(empty.unchecked,true);assert.equal(empty.characters,0);assert.equal(empty.excludedItems,3);
 for(const bad of[{cropped:false},{...report(),matrix:[NaN,0,0,1,0,0]},{...report(),cropBounds:{x:0,y:0,width:0,height:100}}])assert.equal(verify(content([body]),content([body]),bad).ok,false);
});

test('offset rotations and rotated text matrices use source PDF coordinates without applying /Rotate twice',()=>{
 const source=content([item('BODY',30,40,20)]),r=report({matrix:[0,1,-1,0,190,40],cropBounds:{x:100,y:50,width:80,height:80},rotation:90});
 assert.equal(verify(source,content([{str:'BODY'}]),r).ok,true);assert.equal(verify(source,content([]),r).reason,'missing-retained-text');
 const rotated={...item('ROTATED',40,30,15),transform:[0,10,-10,0,40,30]};
 const checked=verify(content([rotated]),content([{str:'ROTATED'}]),report());assert.equal(checked.expectedItems,1);assert.equal(checked.ok,true);
});

test('additional displayed margins respect all /Rotate values and UserUnit before optional A4 fitting',()=>{
 const source=content([item('LEFT',2,50,3,2),item('RIGHT',94,50,3,2),item('TOP',50,97,3,2),item('BOTTOM',50,3,3,2),item('BODY',50,50,3,2),item('NEAR TOP',50,85,3,2)]);
 for(const [rotation,removed]of[[0,'TOP'],[90,'LEFT'],[180,'BOTTOM'],[270,'RIGHT']]){
  const output=content(source.items.filter(i=>i.str!==removed)),result=verify(source,output,report({rotation,userUnit:2}),{crop:true,margins:[20*25.4/72,0,0,0],paper:'a4'});
  assert.equal(result.ok,true,rotation);assert.equal(result.excludedItems,1,rotation);assert.equal(result.expectedItems,5,rotation);
 }
 assert.equal(verify(source,source,report(),{crop:true,margins:[NaN,0,0,0]}).reason,'invalid-crop-geometry');
});

const root=path.resolve(__dirname,'..'),scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const ctx=vm.createContext({console:{log(){},warn(){},error:console.error},setTimeout,clearTimeout,TextEncoder,TextDecoder,URL,URLSearchParams,Blob,ReadableStream,WritableStream,TransformStream,AbortController,AbortSignal,atob,btoa,DOMException,ArrayBuffer,Uint8Array,Uint8ClampedArray,Int8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,DataView,assert});
for(const marker of['sourceMappingURL=pdf-lib.min.js.map','pdfjs-dist/build/pdf"]','pdfjs-dist/build/pdf.worker'])vm.runInContext(scripts.find(s=>s.includes(marker)),ctx);
for(const name of['pro-document','pro-deskew','pro-text-verification'])vm.runInContext(fs.readFileSync(path.join(root,'src',name+'.js'),'utf8'),ctx);
test('real cropped PDFs may omit edge text but must retain interior vector and invisible OCR text',async()=>{
 await vm.runInContext(`(async()=>{
  async function fixture(rotation,omitBody=false){
   const P=PDFLib,d=await P.PDFDocument.create(),font=await d.embedFont(P.StandardFonts.Helvetica),p=d.addPage([400,600]);p.setMediaBox(-20,40,400,600);p.setCropBox(5,65,350,535);p.setRotation(P.degrees(rotation));
   for(const[text,x,y]of[['TOP EDGE TEXT',25,588],['BOTTOM EDGE TEXT',25,68],['LEFT',6,330],['RIGHT',320,330]])p.drawText(text,{x,y,font,size:8});
   if(!omitBody)p.drawText('CENTER BODY 2468',{x:110,y:320,font,size:12});p.drawText('INVISIBLE CORE 99',{x:110,y:355,font,size:10,opacity:0});return d;
  }
  async function text(doc){const task=pdfjsLib.getDocument({data:await doc.save(),verbosity:0});try{return await(await(await task.promise).getPage(1)).getTextContent();}finally{await task.destroy();}}
  for(const rotation of[0,90,180,270])for(const angle of[-60,-3,3,60])for(const paper of['original','a4']){
   const d=await fixture(rotation),before=await text(d),options={deskew:false,deskewAngles:{page:angle},deskewCropByPage:{page:true},crop:false,paper,number:false,watermark:''};
   const report=(await PDFDeskew.processDocument(d,options,{pageIds:['page']})).pages[0];await PDFProDocument.applyDocument(d,options);const after=await text(d);
   const result=PDFProTextVerification.verify(before,after,report,options);assert.equal(result.ok,true,JSON.stringify({rotation,angle,paper,result}));assert.ok(result.expectedItems>=2);assert.ok(result.excludedItems>=2);assert.equal(result.unchecked,false);
   const damaged=await fixture(rotation,true);await PDFDeskew.processDocument(damaged,options,{pageIds:['page']});await PDFProDocument.applyDocument(damaged,options);
   const failed=PDFProTextVerification.verify(before,await text(damaged),report,options);assert.equal(failed.ok,false);assert.equal(failed.reason,'missing-retained-text');
  }
 })()`,ctx);
});
