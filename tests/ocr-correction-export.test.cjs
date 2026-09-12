const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {inflateSync}=require('node:zlib');

const root=path.resolve(__dirname,'..');
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const context=vm.createContext({
  console:{log(){},warn(){},error:console.error},setTimeout,clearTimeout,
  TextEncoder,TextDecoder,URL,URLSearchParams,Blob,ReadableStream,WritableStream,TransformStream,
  AbortController,AbortSignal,atob,btoa,DOMException,ArrayBuffer,Uint8Array,Uint8ClampedArray,
  Int8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,DataView
});
for(const marker of ['sourceMappingURL=pdf-lib.min.js.map','pdfjs-dist/build/pdf"]','pdfjs-dist/build/pdf.worker']){
  const script=scripts.find(s=>s.includes(marker));assert.ok(script,'Missing embedded dependency '+marker);vm.runInContext(script,context);
}
vm.runInContext(fs.readFileSync(path.join(root,'vendor/markup/fontkit.umd.min.js'),'utf8'),context);
const fontBytes=new Uint8Array(inflateSync(fs.readFileSync(path.join(root,'vendor/markup/NanumGothic.ttf.zlib'))));
const font=context.fontkit.create(fontBytes),fontLoads=[];
context.PDFMarkupText={async load(name){fontLoads.push(name);return {font,bytes:fontBytes};}};
for(const file of ['pro-document.js','pro-ocr.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',file),'utf8'),context);
const {PDFLib:P,PDFOCR,PDFProDocument:geometry,pdfjsLib}=context;
const near=(actual,expected,message,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} != ${expected}`);
const addPage=(doc,width,height)=>doc.addPage(vm.runInContext(`[${width},${height}]`,context));

async function parsed(doc){return pdfjsLib.getDocument({data:await doc.save(),isEvalSupported:false}).promise;}
function streams(page){
  const contents=page.node.Contents();
  return Array.from({length:contents?.size()||0},(_,i)=>Buffer.from(P.decodePDFRawStream(contents.lookup(i)).decode()).toString('utf8')).join('\n');
}
function fontInfo(doc,page){
  const fonts=page.node.Resources().lookup(P.PDFName.of('Font'));
  const type0=fonts.lookup(fonts.keys()[0]),descendant=type0.lookup(P.PDFName.of('DescendantFonts')).lookup(0);
  const widths=descendant.lookup(P.PDFName.of('W')).lookup(1).asArray().map(v=>v.asNumber());
  const cmap=Buffer.from(P.decodePDFRawStream(type0.lookup(P.PDFName.of('ToUnicode'))).decode()).toString('utf8');
  const mapping=new Map();
  for(const block of cmap.matchAll(/\d+ beginbfchar\n([\s\S]*?)endbfchar/g))for(const match of block[1].matchAll(/<([0-9A-F]+)> <([0-9A-F]+)>/g)){
    const units=match[2].match(/.{4}/g).map(s=>parseInt(s,16));mapping.set(parseInt(match[1],16),String.fromCharCode(...units));
  }
  return {widths,mapping};
}

test('corrected Korean text is searchable; removed regions and superseded text are absent',async()=>{
  const doc=await P.PDFDocument.create();addPage(doc,500,700);addPage(doc,500,700);
  const original={uid:'contract',source:'paddle-v5',text:'수정 전 원본 오인식',words:[
    {text:'계약금 일백원',box:[.1,.1,.75,.14],separator:'\n'},
    {text:'삭제할 오인식',box:[.1,.2,.75,.24],separator:'\n'},
    {text:'권리 설정자',box:[.1,.3,.75,.34],separator:'\n'}
  ]};
  const corrected=structuredClone(original);
  corrected.words[0].text='계약금 123,450원';corrected.words[1].text='';corrected.words[2].text='공동명의 계약자 😀';
  corrected.text=corrected.words.filter(w=>w.text.trim()).map(w=>w.text+w.separator).join('').trim();
  const report=await PDFOCR.apply(doc,[corrected,
    {uid:'removed-page',source:'paddle-v5',words:[{text:' \t\n',box:[.1,.1,.5,.2]}]},
    {uid:'outside-selection',source:'paddle-v5',words:[{text:'다른 페이지 문구',box:[.1,.1,.5,.2]}]}
  ],{pageIds:['contract','removed-page']});
  assert.equal(report.pages,1);assert.equal(report.words,2);assert.equal(original.words[0].text,'계약금 일백원','Export mutated the original recognition');
  const pdf=await parsed(doc);
  try{
    const first=(await(await pdf.getPage(1)).getTextContent()).items.filter(i=>i.str.trim()).map(i=>i.str.trim());
    assert.deepEqual([...first],['계약금 123,450원','공동명의 계약자 😀']);
    assert.doesNotMatch(first.join('\n'),/일백원|삭제할|오인식|권리 설정자|다른 페이지/);
    assert.equal((await(await pdf.getPage(2)).getTextContent()).items.filter(i=>i.str.trim()).length,0);
  }finally{await pdf.destroy();}
  const reloaded=await P.PDFDocument.load(await doc.save());
  assert.equal((streams(reloaded.getPage(0)).match(/\bTj\b/g)||[]).length,2,'Deleted region left a text operation');
  assert.equal(reloaded.getPage(1).node.Contents()?.size()||0,0,'A fully cleared page gained an empty OCR layer');
  const unicode=[...fontInfo(reloaded,reloaded.getPage(0)).mapping.values()].join('');
  assert.ok(unicode.includes('😀'),'ToUnicode lost a supplementary code point');
  for(const ch of '공동명의계약자')assert.ok(unicode.includes(ch),'Missing corrected Korean character '+ch);
});

test('paddle-v5 selects actual bundled proportional metrics even without a granularity hint',async()=>{
  const doc=await P.PDFDocument.create(),page=addPage(doc,500,700),before=fontLoads.length;
  await PDFOCR.apply(doc,[{uid:'one',source:'paddle-v5',words:[{text:'Wi한',box:[.1,.1,.8,.15],separator:'\n'}]}],{pageIds:['one']});
  assert.deepEqual(fontLoads.slice(before),['gothic']);
  const {widths,mapping}=fontInfo(doc,page);
  const advance=ch=>widths[[...mapping].find(([,value])=>value===ch)[0]-1];
  for(const ch of ['W','i','한',' '])near(advance(ch),font.glyphForCodePoint(ch.codePointAt(0)).advanceWidth/font.unitsPerEm*1000,'Bundled glyph width '+ch);
  assert.notEqual(advance('W'),advance('i'),'OCR fell back to uniform character widths');
  assert.ok(advance(' ')<advance('한'),'Space was given a Korean glyph width');
});

test('edited line advance, including emitted separator space, fits its box at every page rotation',async()=>{
  const doc=await P.PDFDocument.create(),ids=['zero','ninety','half','three-quarter'];
  const words=[
    {text:'I',box:[.11,.12,.27,.18],separator:'\n'},
    {text:'수정 계약금 123,450원 Wi',box:[.13,.28,.81,.34],separator:' '},
    {text:'공동명의자',box:[.21,.43,.71,.50],separator:''}
  ];
  for(let i=0;i<4;i++){
    const page=addPage(doc,430,660);page.setMediaBox(-20,40,430,660);page.setCropBox(5,65,380,595);
    page.setRotation(P.degrees(i*90));page.node.set(P.PDFName.of('UserUnit'),P.PDFNumber.of(2));
  }
  await PDFOCR.apply(doc,ids.map(uid=>({uid,source:'paddle-v5',words})),{pageIds:ids});
  const reloaded=await P.PDFDocument.load(await doc.save()),pdf=await parsed(doc);
  try{
    for(let i=0;i<4;i++){
      const page=reloaded.getPage(i),b=geometry.visibleBox(page),rotation=i*90,w=rotation%180?b.height:b.width,h=rotation%180?b.width:b.height;
      const {widths,mapping}=fontInfo(reloaded,page),content=streams(page);
      assert.match(content,/\b3 Tr\b/,'Corrected search text must remain invisible');
      const runs=[...content.matchAll(/([-+\d.eE ]+) Tm\s*<([0-9A-F]+)> Tj/g)];
      assert.equal(runs.length,words.length);
      const jsPage=await pdf.getPage(i+1),viewport=jsPage.getViewport({scale:1});
      const items=(await jsPage.getTextContent()).items.filter(item=>item.str.trim());
      assert.equal(items.length,words.length);
      for(let n=0;n<words.length;n++){
        const word=words[n],matrix=runs[n][1].trim().split(/\s+/).map(Number),codes=runs[n][2].match(/.{4}/g).map(code=>parseInt(code,16));
        const emitted=codes.map(code=>mapping.get(code)).join('');
        assert.equal(emitted,word.text+(word.separator===''?'':' '),'Actual PDF text operation lost the intended separator');
        const advance=codes.reduce((sum,code)=>sum+widths[code-1],0)/1000;
        const start=viewport.convertToViewportPoint(matrix[4],matrix[5]);
        const end=viewport.convertToViewportPoint(matrix[4]+matrix[0]*advance,matrix[5]+matrix[1]*advance);
        near(start[0]/viewport.width,word.box[0],'Left edge at rotation '+rotation);
        near(end[0]/viewport.width,word.box[2],'Right edge including separator at rotation '+rotation);
        near(start[1]/viewport.height,word.box[3]-(word.box[3]-word.box[1])*.18,'Baseline at rotation '+rotation);
        near(end[1],start[1],'Text baseline remained horizontal in displayed page');
        near(Math.hypot(matrix[0],matrix[1])*advance,(word.box[2]-word.box[0])*w,'PDF physical width');
        near(Math.hypot(matrix[2],matrix[3]),(word.box[3]-word.box[1])*h,'PDF physical height');
        assert.equal(items[n].str.trim(),word.text,'PDF.js extraction differed from the corrected text');
        const textStart=viewport.convertToViewportPoint(items[n].transform[4],items[n].transform[5]);
        assert.ok(textStart[0]+items[n].width<=word.box[2]*viewport.width+1e-5,'Extracted text extends beyond its box');
      }
    }
  }finally{await pdf.destroy();}
});
