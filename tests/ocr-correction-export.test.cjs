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
function fontInfo(doc,page,name){
  const fonts=page.node.Resources().lookup(P.PDFName.of('Font'));
  const type0=fonts.lookup(name?P.PDFName.of(name):fonts.keys()[0]),descendant=type0.lookup(P.PDFName.of('DescendantFonts')).lookup(0);
  const widths=descendant.lookup(P.PDFName.of('W')).lookup(1).asArray().map(v=>v.asNumber());
  const cmap=Buffer.from(P.decodePDFRawStream(type0.lookup(P.PDFName.of('ToUnicode'))).decode()).toString('utf8');
  const mapping=new Map();
  for(const block of cmap.matchAll(/\d+ beginbfchar\n([\s\S]*?)endbfchar/g))for(const match of block[1].matchAll(/<([0-9A-F]+)> <([0-9A-F]+)>/g)){
    const units=match[2].match(/.{4}/g).map(s=>parseInt(s,16));mapping.set(parseInt(match[1],16),String.fromCharCode(...units));
  }
  return {widths,mapping};
}
function decodedRuns(doc,page){
  let name;const out=[];
  for(const match of streams(page).matchAll(/\/([^\s]+) 1 Tf|([-+\d.eE ]+) Tm\s*<([0-9A-F]+)> Tj/g)){
    if(match[1]){name=match[1];continue;}
    const info=fontInfo(doc,page,name),codes=match[3].match(/.{4}/g).map(code=>parseInt(code,16));
    out.push({name,codes,matrix:match[2].trim().split(/\s+/).map(Number),text:codes.map(code=>info.mapping.get(code)).join(''),advance:codes.reduce((sum,code)=>sum+info.widths[code-1],0)/1000,...info});
  }
  return out;
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

test('a large Vision correction replaces only its covered words and preserves untouched word fonts and boxes',async()=>{
  const doc=await P.PDFDocument.create(),ids=['v0','v90','v180','v270'];
  const words=[
    {text:'Wi 계약서',box:[.1,.1,.4,.15],separator:'\n',confidence:92},
    {text:'삭제될',box:[.1,.25,.2,.3],separator:' ',confidence:81},
    {text:'옛 금액',box:[.24,.25,.4,.3],separator:' ',confidence:75},
    {text:'오인식',box:[.44,.25,.65,.3],separator:'\n',confidence:63},
    {text:'보존한 단어',box:[.1,.42,.4,.47],separator:'\n',confidence:96}
  ];
  const replacement={indices:[1,2,3],text:'계약금 일금 123,450원 (공동명의자 수정)',box:[.1,.25,.65,.3]};
  const records=ids.map(uid=>({uid,source:'vision',granularity:'word',words:structuredClone(words),correctionLines:[structuredClone(replacement)]})),snapshot=structuredClone(records);
  for(let i=0;i<4;i++){const page=addPage(doc,430,660);page.setMediaBox(-20,40,430,660);page.setCropBox(5,65,380,595);page.setRotation(P.degrees(i*90));page.node.set(P.PDFName.of('UserUnit'),P.PDFNumber.of(2));}
  const before=fontLoads.length,report=await PDFOCR.apply(doc,records,{pageIds:ids});
  assert.equal(report.pages,4);assert.equal(report.words,12);assert.deepEqual(fontLoads.slice(before),['gothic']);assert.deepEqual(records,snapshot,'Writer mutated original Vision words or correction metadata');
  const loaded=await P.PDFDocument.load(await doc.save()),pdf=await parsed(doc),expected=[words[0],{...replacement,separator:'\n'},words[4]];
  try{
    for(let i=0;i<4;i++){
      const page=loaded.getPage(i),runs=decodedRuns(loaded,page),jsPage=await pdf.getPage(i+1),viewport=jsPage.getViewport({scale:1});
      const text=(await jsPage.getTextContent()).items.filter(item=>item.str.trim()).map(item=>item.str.trim());
      assert.equal(text.join(' ').replace(/\s+/g,' '),expected.map(word=>word.text).join(' '));assert.doesNotMatch(text.join('\n'),/삭제될|옛 금액|오인식/);assert.equal(runs.length,3);
      assert.notEqual(runs[0].name,runs[1].name,'Corrected line reused the untouched word font');assert.equal(runs[0].name,runs[2].name,'An untouched following word lost its original font');
      for(const run of [runs[0],runs[2]])assert.ok(run.widths.every(width=>width===600),'Unchanged Vision word character advances changed');
      for(const [code,ch] of runs[1].mapping){const width=font.hasGlyphForCodePoint(ch.codePointAt(0))?font.glyphForCodePoint(ch.codePointAt(0)).advanceWidth/font.unitsPerEm*1000:600;near(runs[1].widths[code-1],width,'Corrected line proportional glyph '+ch);}
      for(let n=0;n<runs.length;n++){
        const run=runs[n],box=expected[n].box,start=viewport.convertToViewportPoint(run.matrix[4],run.matrix[5]);
        const end=viewport.convertToViewportPoint(run.matrix[4]+run.matrix[0]*run.advance,run.matrix[5]+run.matrix[1]*run.advance);
        assert.equal(run.text,expected[n].text+' ');near(start[0]/viewport.width,box[0],'Vision start '+i+'/'+n);near(end[0]/viewport.width,box[2],'Vision end '+i+'/'+n);
        near(start[1]/viewport.height,box[3]-(box[3]-box[1])*.18,'Vision baseline '+i+'/'+n);near(end[1],start[1],'Vision displayed baseline');
      }
    }
  }finally{await pdf.destroy();}
});

test('an explicitly cleared correction line removes its covered words without erasing other text',async()=>{
  const doc=await P.PDFDocument.create();addPage(doc,500,700);
  const words=[{text:'전체 삭제할 줄',box:[.1,.1,.7,.2],separator:'\n'},{text:'남기는 문장',box:[.1,.3,.7,.4],separator:'\n'}];
  const report=await PDFOCR.apply(doc,[{uid:'one',source:'vision',words,correctionLines:[{indices:[0],text:'',box:words[0].box}]}],{pageIds:['one']});
  assert.equal(report.pages,1);assert.equal(report.words,1);const pdf=await parsed(doc);
  try{assert.equal((await(await pdf.getPage(1)).getTextContent()).items.filter(item=>item.str.trim()).map(item=>item.str.trim()).join(' '),'남기는 문장');}finally{await pdf.destroy();}
});

test('invalid or overlapping correction metadata fails before any PDF text or font is appended',async()=>{
  const words=[{text:'첫 단어',box:[.1,.1,.3,.2],separator:' '},{text:'둘째 단어',box:[.4,.1,.7,.2],separator:'\n'}];
  const valid={indices:[0,1],text:'교정한 문장',box:[.1,.1,.7,.2]};
  const cases=[
    null,{},[{...valid,indices:[]}],[{...valid,indices:[0,0]}],[{...valid,indices:[-1]}],[{...valid,indices:[2]}],[{...valid,indices:[.5]}],
    [{...valid,box:[.1,.1,.8,.2]}],[{...valid,box:[.1,.1,Infinity,.2]}],[{...valid,text:'다른\n글줄'}],
    [valid,{indices:[1],text:'중복 교정',box:words[1].box}]
  ];
  for(const correctionLines of cases){
    const doc=await P.PDFDocument.create();const page=addPage(doc,500,700),initialObjects=doc.context.enumerateIndirectObjects().length;
    await assert.rejects(PDFOCR.apply(doc,[{uid:'one',source:'vision',words,correctionLines}],{pageIds:['one']}),/OCR 교정 글줄/);
    assert.equal(doc.context.enumerateIndirectObjects().length,initialObjects,'Invalid correction added font objects');assert.equal(page.node.Contents()?.size()||0,0,'Invalid correction partially altered the PDF');
  }
  const doc=await P.PDFDocument.create();addPage(doc,500,700);addPage(doc,500,700);
  await assert.rejects(PDFOCR.apply(doc,[{uid:'valid',source:'vision',words,correctionLines:[valid]},{uid:'bad',source:'vision',words,correctionLines:[{...valid,indices:[9]}]}],{pageIds:['valid','bad']}),/OCR 교정 글줄/);
  assert.ok(doc.getPages().every(page=>!page.node.Contents()?.size()),'An earlier valid page was written before rejecting a later invalid correction');
});
