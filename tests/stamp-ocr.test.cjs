const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),stamp=require('../src/pro-stamp.js');
test('paper removal retains saturated and faint ink, preserves transparency and never mutates source',()=>{
  const source=new Uint8ClampedArray([245,241,233,255,178,31,45,255,230,180,185,255,255,255,255,0]);
  const copy=source.slice(),out=stamp.removePaper(source,{strength:35});
  assert.deepEqual(source,copy);assert.equal(out[3],0);assert.ok(out[7]>150);assert.ok(out[11]>20);assert.equal(out[15],0);
  assert.deepEqual(stamp.removePaper(source,{strength:0}),source);
  assert.equal(stamp.bounds(new Uint8ClampedArray(16),2,2),null);
});
test('repeated stamps respect physical corner offsets and fit small pages without clipping',()=>{
  const mm=72/25.4,mark={width:30,ratio:2,x:15,y:20,anchor:'bottom-right'};
  const p=stamp.placement(mark,210*mm,297*mm);
  assert.ok(Math.abs(p.x/mm-165)<1e-8);assert.ok(Math.abs(p.y/mm-262)<1e-8);
  const small=stamp.placement({...mark,width:300},10*mm,10*mm);
  assert.ok(small.x>=0&&small.y>=0&&small.x+small.width<=10*mm&&small.y+small.height<=10*mm);
});
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const ctx=vm.createContext({console:{log(){},warn(){},error:console.error},setTimeout,clearTimeout,TextEncoder,TextDecoder,URL,URLSearchParams,Blob,ReadableStream,WritableStream,TransformStream,AbortController,AbortSignal,atob,btoa,DOMException,ArrayBuffer,Uint8Array,Uint8ClampedArray,Int8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,DataView,assert});
for(const marker of ['sourceMappingURL=pdf-lib.min.js.map','pdfjs-dist/build/pdf"]','pdfjs-dist/build/pdf.worker'])vm.runInContext(scripts.find(s=>s.includes(marker)),ctx);
for(const name of ['pro-document','pro-stamp','pro-ocr'])vm.runInContext(fs.readFileSync(path.join(root,'src',name+'.js'),'utf8'),ctx);
test('Unicode OCR layer extracts Korean, Latin and supplementary characters for rotated offset pages',async()=>{
  await vm.runInContext(`(async()=>{
    const P=PDFLib,doc=await P.PDFDocument.create(),ids=['a','b','c','d'];
    ids.forEach((id,i)=>{const pg=doc.addPage([400,600]);pg.setMediaBox(-20,40,400,600);pg.setCropBox(5,65,350,535);pg.setRotation(P.degrees(i*90));pg.node.set(P.PDFName.of('UserUnit'),P.PDFNumber.of(2));});
    const records=ids.map(uid=>({uid,words:[{text:'한글검색',box:[.1,.1,.35,.15]},{text:'SEARCH123😀',box:[.4,.1,.75,.15]}]}));
    const report=await PDFOCR.apply(doc,records,{pageIds:ids});assert.equal(report.pages,4);assert.equal(report.words,8);
    const pdf=await pdfjsLib.getDocument({data:await doc.save(),isEvalSupported:false}).promise;
    try{for(let i=1;i<=4;i++){const pg=await pdf.getPage(i),vp=pg.getViewport({scale:1}),items=(await pg.getTextContent()).items.filter(t=>t.str.trim());
      assert.equal(items.length,2);assert.equal(items[0].str.trim(),'한글검색');assert.equal(items[1].str.trim(),'SEARCH123😀');
      const point=vp.convertToViewportPoint(items[0].transform[4],items[0].transform[5]);assert.ok(Math.abs(point[0]/vp.width-.1)<.001);assert.ok(Math.abs(point[1]/vp.height-.141)<.001);
    }}finally{await pdf.destroy();}
  })()`,ctx);
});
test('stamp targets follow page IDs across reordering; one preview matches the same full output page',async()=>{
  await vm.runInContext(`(async()=>{
    const P=PDFLib,doc=await P.PDFDocument.create();for(let i=0;i<4;i++){const p=doc.addPage([400,600]);p.setRotation(P.degrees(i*90));}
    const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
    const mark={data,scope:'selected',targets:['d','b'],anchor:'bottom-right',width:30,ratio:1,x:15,y:20,opacity:1};
    assert.equal(await PDFStamp.apply(doc,[mark],{pageIds:['b','a','d','c']}),2);
    const streams=doc.getPages().map(p=>p.node.Contents()?.size()||0);assert.ok(streams[0]>0&&streams[2]>0);assert.equal(streams[1],0);assert.equal(streams[3],0);
    const preview=await P.PDFDocument.create();const p=preview.addPage([400,600]);p.setRotation(P.degrees(180));
    assert.equal(await PDFStamp.apply(preview,[mark],{pageIds:['d']}),1);
    const content=pg=>pg.node.Contents().lookup(0).getContentsString().replace(/\\/(?:GS|Image)-[0-9]+/g,'/RESOURCE');assert.equal(content(preview.getPage(0)),content(doc.getPage(2)));
    const ctrl=new AbortController();ctrl.abort();await assert.rejects(PDFStamp.apply(doc,[mark],{pageIds:['b'],signal:ctrl.signal}),{name:'AbortError'});
  })()`,ctx);
});
test('compression never discards explicitly requested stamps or OCR',()=>{
  const {selectOutput}=require('../src/pro-result.js'),base=new Uint8Array(10),candidate=new Uint8Array(20),o={optimize:true,whitePoint:255,paper:'original'};
  assert.equal(selectOutput(base,candidate,{...o,stamps:[{}]}).bytes,candidate);
  assert.equal(selectOutput(base,candidate,{...o,ocr:[{}]}).bytes,candidate);
});
