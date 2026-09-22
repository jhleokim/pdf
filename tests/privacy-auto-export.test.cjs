const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {inflateSync}=require('node:zlib');
const detect=require('../src/privacy-detect.js'),model=require('../src/privacy-auto-model.js');
const root=path.resolve(__dirname,'..'),runtime=Promise.all([import('../src/privacy-native-worker.js'),import('mupdf')]);
const context=vm.createContext({Array,Uint8Array,ArrayBuffer,Int8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,setTimeout,clearTimeout,TextEncoder,TextDecoder,DOMException});
const pdfScript=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('.PDFLib='));assert.ok(pdfScript);
vm.runInContext(pdfScript,context);vm.runInContext(fs.readFileSync(path.join(root,'vendor/markup/fontkit.umd.min.js'),'utf8'),context);
const fontBytes=new Uint8Array(inflateSync(fs.readFileSync(path.join(root,'vendor/markup/NanumGothic.ttf.zlib')))),metrics=context.fontkit.create(fontBytes);
context.PDFMarkupText={async load(){return {font:metrics,bytes:fontBytes};}};
context.PDFTesseractAssets={get:id=>id==='ocr-search-font'?new Uint8Array(fs.readFileSync(path.join(root,'vendor/markup/GlyphLessFont.ttf'))):null};
let nativeCalls=0,ocrCalls=0;
context.PDFPrivacyNative={async run(bytes,masks,{onProgress}={}){nativeCalls++;const [engine]=await runtime;return engine.process({bytes,masks},onProgress);}};
for(const name of ['pro-document.js','pro-ocr.js','privacy-export.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',name),'utf8'),context);
const {PDFLib:P,PDFOCR,PDFPrivacy}=context,N=P.PDFName.of,apply=PDFOCR.apply;
PDFOCR.apply=async(...args)=>{ocrCalls++;return apply(...args);};

async function withPDF(bytes,fn){const [,M]=await runtime,doc=M.Document.openDocument(bytes,'application/pdf');try{return await fn(doc,M);}finally{doc.destroy();}}
async function texts(bytes){return withPDF(bytes,doc=>{const text=[];for(let i=0;i<doc.countPages();i++){const page=doc.loadPage(i),content=page.toStructuredText();try{text.push(content.asText());}finally{content.destroy();page.destroy();}}return text;});}
async function boxFor(bytes,text,pageIndex=0){return withPDF(bytes,doc=>{
  const page=doc.loadPage(pageIndex);try{const hit=page.search(text)[0]?.[0];assert.ok(hit,'fixture text is searchable: '+text);const b=page.getBounds(),xs=hit.filter((_,i)=>i%2===0),ys=hit.filter((_,i)=>i%2===1);return [(Math.min(...xs)-b[0])/(b[2]-b[0]),(Math.min(...ys)-b[1])/(b[3]-b[1]),(Math.max(...xs)-b[0])/(b[2]-b[0]),(Math.max(...ys)-b[1])/(b[3]-b[1])];}finally{page.destroy();}
});}
async function pixels(bytes,pageIndex=0){return withPDF(bytes,(doc,M)=>{const page=doc.loadPage(pageIndex),pix=page.toPixmap(M.Matrix.identity,M.ColorSpace.DeviceRGB,false);try{return {width:pix.getWidth(),height:pix.getHeight(),stride:pix.getStride(),data:Buffer.from(pix.getPixels())};}finally{pix.destroy();page.destroy();}});}
async function png(bytes,pageIndex=0){return withPDF(bytes,(doc,M)=>{const page=doc.loadPage(pageIndex),pix=page.toPixmap(M.Matrix.identity,M.ColorSpace.DeviceRGB,false);try{return pix.asPNG().slice();}finally{pix.destroy();page.destroy();}});}
function imageCount(doc){return doc.context.enumerateIndirectObjects().filter(([,object])=>object instanceof P.PDFRawStream&&String(object.dict.get(N('Subtype')))==='/Image').length;}
async function fixture(rows){
  const doc=await P.PDFDocument.create(),page=doc.addPage([600,800]),font=await doc.embedFont(P.StandardFonts.Courier);
  rows.forEach((text,index)=>page.drawText(text,{x:40,y:730-index*70,size:18,font}));
  page.drawText('PUBLIC CONTRACT TERMS',{x:40,y:440,size:18,font});page.drawRectangle({x:40,y:120,width:80,height:40,color:P.rgb(0,1,0)});
  const untouched=doc.addPage([400,300]);untouched.drawText('UNTOUCHED SECOND PAGE',{x:25,y:230,size:16,font});untouched.drawRectangle({x:30,y:30,width:90,height:30,color:P.rgb(0,0,1)});
  return {bytes:await doc.save(),measure:text=>font.widthOfTextAtSize(text,18)};
}
async function recognized(bytes,fields,{corrected=false,scan=false}={}){
  const words=[],nativeTextBoxes=[];
  for(const [label,value]of fields){
    const labelBox=await boxFor(bytes,label),valueBox=await boxFor(bytes,value);words.push({text:label,box:labelBox,separator:' ',confidence:99},{text:value,box:valueBox,separator:'\n',confidence:99});
    nativeTextBoxes.push(await boxFor(bytes,label+' '+value));
  }
  const safe=await boxFor(bytes,'PUBLIC CONTRACT TERMS');words.push({text:'PUBLIC CONTRACT TERMS',box:safe,separator:'\n',confidence:99});nativeTextBoxes.push(safe);
  words.push({text:'추가 인식된 공개 문장',box:[.1,.62,.65,.66],separator:'\n',confidence:98});
  const record={uid:'page-1',key:'old-ocr-key',privacyKey:null,page:1,source:'vision',language:'kor+eng',granularity:'word',coverage:'full',words,text:words.map(w=>w.text).join('\n'),nativeTextBoxes:scan?[]:nativeTextBoxes,nativeTextUnmapped:false,rawText:'OLD SENSITIVE PAYLOAD',response:{text:'OLD SENSITIVE PAYLOAD'},tables:[{cells:[{text:'OLD SENSITIVE PAYLOAD'}]}]};
  if(corrected){record.words[1].text='900101-1234561';record.correctionLines=[{indices:[1],box:[...record.words[1].box],text:'900101-1234567'}];record.correctionGroups=[{indices:[1]}];}
  return record;
}
async function secureExport(bytes,record,settings,measure){
  const candidates=detect.detect(record,settings,measure),boxes=candidates.flatMap(candidate=>candidate.boxes),clean=model.sanitizeRecord(record,boxes,PDFOCR.correctionWords);
  const doc=await P.PDFDocument.load(bytes),pageSources=doc.getPages().map((_,i)=>({uid:'page-'+(i+1),docId:'synthetic',srcIndex:i,rotation:0,annots:i?[]:boxes.map((b,j)=>({id:'auto-'+j,shape:'redaction',nx:b[0],ny:b[1],nw:b[2]-b[0],nh:b[3]-b[1]}))}));
  clean.key='new-ocr-key';clean.privacyKey=PDFPrivacy.maskKey(pageSources[0]);
  const before={nativeCalls,ocrCalls},redacted=await PDFPrivacy.redact(doc,pageSources,{sources:new Map([['synthetic',{libBytes:bytes}]])});
  const exported=await PDFPrivacy.flatten(redacted,{pageSources,ocr:[clean]});
  assert.equal(nativeCalls-before.nativeCalls,2,'the real native redactor and final scrub both ran');assert.equal(ocrCalls-before.ocrCalls,1,'the actual searchable OCR writer ran');
  return {bytes:await exported.save(),doc:exported,candidates,boxes,clean};
}
function assertBlack(image,box){const x=Math.floor((box[0]+box[2])*.5*image.width),y=Math.floor((box[1]+box[3])*.5*image.height),at=y*image.stride+x*3;assert.deepEqual([...image.data.subarray(at,at+3)],[0,0,0],'the approved region is visibly covered');}

test('detector to secure native export removes corrected PII while preserving native and Korean OCR search without rasterization',async()=>{
  const original=await fixture(['ID: 900101-1234567','ACCOUNT: 123-456-789012']),record=await recognized(original.bytes,[['ID:','900101-1234567'],['ACCOUNT:','123-456-789012']],{corrected:true}),snapshot=structuredClone(record);
  const output=await secureExport(original.bytes,record,{types:['rrn','account'],style:'full'},original.measure);
  assert.deepEqual(output.candidates.map(c=>c.type),['rrn','account']);assert.equal(output.candidates[0].approximate,true,'a corrected OCR line remains a review proposal');
  const text=await texts(output.bytes);assert.doesNotMatch(text.join('\n'),/900101|123456[17]|123-456-789012|OLD SENSITIVE/);assert.match(text[0],/ID:/);assert.match(text[0],/ACCOUNT:/);assert.match(text[0],/PUBLIC CONTRACT TERMS/);assert.match(text[0],/추가 인식된 공개 문장/);
  assert.equal((text[0].match(/PUBLIC CONTRACT TERMS/g)||[]).length,1,'whole-page OCR does not duplicate existing native text');
  assert.doesNotMatch(output.clean.text,/900101|123456[17]|789012/);assert.doesNotMatch(JSON.stringify(output.clean),/900101|123456[17]|789012|OLD SENSITIVE/);assert.deepEqual(record,snapshot,'the source OCR remains unchanged until the controller commits');
  assert.equal(imageCount(output.doc),0,'no page became an image');
  const originalSecond=await pixels(original.bytes,1),savedSecond=await pixels(output.bytes,1);assert.deepEqual(savedSecond,originalSecond,'the untouched page renders identically');
  const rendered=await pixels(output.bytes);for(const box of output.boxes)assertBlack(rendered,box);
});

test('partial phone and card masks keep allowed native digits but remove the entire intersected OCR word',async()=>{
  const original=await fixture(['PHONE: 010-1234-5678','CARD: 4539-1488-0343-6467']),record=await recognized(original.bytes,[['PHONE:','010-1234-5678'],['CARD:','4539-1488-0343-6467']]);
  const output=await secureExport(original.bytes,record,{types:['phone','card'],style:'partial'},original.measure);
  assert.deepEqual(output.candidates.map(c=>c.maskedText),['010-****-5678','4539-****-****-6467']);assert.ok(output.candidates.every(c=>c.approximate));
  const text=(await texts(output.bytes))[0];assert.match(text,/PHONE:/);assert.match(text,/CARD:/);for(const safe of ['010','5678','4539','6467'])assert.ok(text.includes(safe),'allowed native digits stay searchable: '+safe);
  for(const secret of ['1234','1488','0343','010-1234-5678','4539-1488-0343-6467'])assert.ok(!text.includes(secret),'hidden digits do not survive in native or OCR text: '+secret);
  assert.deepEqual(output.clean.words.filter(w=>/010|5678|4539|6467/.test(w.text)),[],'a whole OCR number box is removed even when only its middle is masked');
  assert.equal(imageCount(output.doc),0);assert.match(text,/추가 인식된 공개 문장/);
});

test('a scan stays an image with native secure pixel deletion, while safe OCR is retained and one-box partial digits are not re-added',async()=>{
  const original=await fixture(['PHONE: 010-1234-5678']),record=await recognized(original.bytes,[['PHONE:','010-1234-5678']],{scan:true}),scanDoc=await P.PDFDocument.create(),image=await scanDoc.embedPng(await png(original.bytes));
  scanDoc.addPage([600,800]).drawImage(image,{x:0,y:0,width:600,height:800});scanDoc.addPage((await scanDoc.copyPages(await P.PDFDocument.load(original.bytes),[1]))[0]);
  const scanBytes=await scanDoc.save();assert.equal(imageCount(scanDoc),1);assert.equal((await texts(scanBytes))[0].trim(),'','the first page really has no original searchable text');
  const output=await secureExport(scanBytes,record,{types:['phone'],style:'partial'},original.measure),text=(await texts(output.bytes))[0];
  assert.match(text,/PHONE:/);assert.match(text,/PUBLIC CONTRACT TERMS/);assert.match(text,/추가 인식된 공개 문장/);assert.doesNotMatch(text,/010|1234|5678/,'one-box OCR cannot safely preserve individual unmasked digits in the search layer');
  assert.equal(imageCount(output.doc),1,'only the original scan image is retained; no extra full-page raster is introduced');assert.deepEqual(await pixels(output.bytes,1),await pixels(scanBytes,1));
  assertBlack(await pixels(output.bytes),output.boxes[0]);
  const images=output.doc.context.enumerateIndirectObjects().map(([,o])=>o).filter(o=>o instanceof P.PDFRawStream&&String(o.dict.get(N('Subtype')))==='/Image');
  const raw=P.decodePDFRawStream(images[0]).decode(),width=images[0].dict.lookup(N('Width')).asNumber(),height=images[0].dict.lookup(N('Height')).asNumber(),box=output.boxes[0],at=(Math.floor((box[1]+box[3])*.5*height)*width+Math.floor((box[0]+box[2])*.5*width))*3;
  assert.ok(raw[at]>240&&raw[at+1]>240&&raw[at+2]>240,'extracting the embedded scan exposes blank pixels, not the original hidden number');
});
