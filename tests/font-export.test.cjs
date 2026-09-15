const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const ctx=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,setTimeout,clearTimeout,atob,btoa,DOMException,URL,URLSearchParams,Blob,ReadableStream,WritableStream,TransformStream,AbortController,AbortSignal});
for(const marker of ['sourceMappingURL=pdf-lib.min.js.map','pdfjs-dist/build/pdf"]','pdfjs-dist/build/pdf.worker'])vm.runInContext(scripts.find(s=>s.includes(marker)),ctx);
vm.runInContext(fs.readFileSync(path.join(root,'vendor/markup/fontkit.umd.min.js'),'utf8'),ctx);
const files={'markup-fontkit':'fontkit.umd.min.js','markup-font-gothic':'NanumGothic.ttf.zlib','markup-font-myeongjo':'NanumMyeongjo.ttf.zlib','markup-font-hana-regular':'Hana2-Regular.ttf.zlib','markup-font-hana-bold':'Hana2-Bold.ttf.zlib','ocr-search-font':'GlyphLessFont.ttf'};
ctx.document={getElementById:id=>({textContent:fs.readFileSync(path.join(root,'vendor/markup',files[id])).toString('base64')}),createElement:()=>({}),head:{appendChild(){}},fonts:{add(){}}};
ctx.b64bytes=text=>new Uint8Array(Buffer.from(text,'base64'));
ctx.FontFace=class{async load(){return this;}};
ctx.hexToRgb=()=>({r:0,g:0,b:0});ctx.rgb=ctx.PDFLib.rgb;
for(const file of ['markup-text.js','pro-document.js','pro-ocr.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',file),'utf8'),ctx);
const T=vm.runInContext('PDFMarkupText',ctx),P=ctx.PDFLib,n=P.PDFName.of;
const data=s=>Buffer.from(P.decodePDFRawStream(s).decode());
const array=a=>vm.runInContext(JSON.stringify(a),ctx);
function fonts(doc,page){return page.node.Resources().lookup(n('Font')).entries().map(([,ref])=>{const type=doc.context.lookup(ref),cid=type.lookup(n('DescendantFonts')).lookup(0),descriptor=cid.lookup(n('FontDescriptor'));return {type,cid,descriptor,ref};});}
async function searchable(bytes){const pdf=await ctx.pdfjsLib.getDocument({data:new Uint8Array(bytes),isEvalSupported:false}).promise;try{return (await (await pdf.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');}finally{await pdf.destroy();}}

test('OCR embeds a valid tiny glyphless TTF, maps every CID to a real glyph, and shares its program',async()=>{
 const doc=await P.PDFDocument.create(),page=doc.addPage(array([595,842]));
 const words=[{text:'원문',box:[.1,.1,.3,.15]},{text:'교정',box:[.1,.2,.3,.25]}];
 await ctx.PDFOCR.apply(doc,[{uid:'one',source:'vision',words,correctionLines:[{indices:[1],text:'수정 계약자 😀',box:words[1].box}]}],{pageIds:['one']});
 const bytes=await doc.save(),out=await P.PDFDocument.load(bytes),loaded=fonts(out,out.getPage(0));
 assert.equal(loaded.length,2,'Word and line geometry must keep independent widths');
 const refs=new Set();
 for(const f of loaded){
  const stream=f.descriptor.lookup(n('FontFile2')),raw=data(stream),ttf=ctx.fontkit.create(new Uint8Array(raw));
  assert.deepEqual(raw,fs.readFileSync(path.join(root,'vendor/markup/GlyphLessFont.ttf')));
  assert.equal(raw.length,572);assert.equal(stream.dict.lookup(n('Length1')).asNumber(),raw.length);
  assert.equal(f.type.get(n('BaseFont')).asString(),f.descriptor.get(n('FontName')).asString());
  const gids=data(f.cid.lookup(n('CIDToGIDMap')));assert.ok(gids.length>2);
  for(let i=0;i<gids.length;i+=2){const gid=gids.readUInt16BE(i);assert.equal(gid,1);assert.ok(gid<ttf.numGlyphs);}
  refs.add(f.descriptor.get(n('FontFile2')).toString());
 }
 assert.equal(refs.size,1,'Each output PDF needs only one glyphless font program');
 assert.match(await searchable(bytes),/원문.*수정 계약자 😀/);
 assert.ok(bytes.length<5000,'Search-only export unexpectedly embeds a large Korean font');
 if(process.env.PDF_FONT_QA_DIR)fs.writeFileSync(path.join(process.env.PDF_FONT_QA_DIR,'OCR-after.pdf'),bytes);
});

for(const [family,file] of [['gothic','NanumGothic'],['myeongjo','NanumMyeongjo'],['hana-regular','Hana2-Regular'],['hana-bold','Hana2-Bold']]){
 test(`${file}: real markup export embeds the original full font once and preserves Korean search`,async()=>{
  const doc=await P.PDFDocument.create(),page=doc.addPage(array([595,842])),f=await T.load(family),cache=new Map(),text='공동명의 계약금 123,450원 ABC';
  const layout=T.layout(f.font,text,18),a={font:family,text,fontSize:18,textLayout:layout,nx:.08,ny:.12,nw:layout.width/595,nh:layout.height/842,color:'#000000',bold:true,italic:true,strike:true};
  const viewport={width:595,height:842,convertToPdfPoint:(x,y)=>[x,842-y]};
  await T.bake(doc,page,a,viewport,0,cache);await T.bake(doc,page,{...a,ny:.25},viewport,0,cache);
  assert.equal(cache.size,1);const bytes=await doc.save(),out=await P.PDFDocument.load(bytes),loaded=fonts(out,out.getPage(0));
  const unique=new Set(loaded.map(f=>f.ref.toString()));assert.equal(unique.size,1);
  for(const info of loaded){
   assert.equal(info.type.get(n('BaseFont')).decodeText(),f.font.postscriptName);
   assert.equal(info.descriptor.get(n('FontName')).decodeText(),f.font.postscriptName);
   assert.deepEqual(data(info.descriptor.lookup(n('FontFile2'))),zlib.inflateSync(fs.readFileSync(path.join(root,'vendor/markup',file+'.ttf.zlib'))));
  }
  assert.ok((await searchable(bytes)).includes(text));
  // Optional local artifacts for a second PDF reader / native Acrobat check.
  if(process.env.PDF_FONT_QA_DIR){fs.mkdirSync(process.env.PDF_FONT_QA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.PDF_FONT_QA_DIR,file+'-after.pdf'),bytes);}
 });
}
