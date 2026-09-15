const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8'),code=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('.PDFLib='));
const mod={exports:{}};vm.runInNewContext(code,{module:mod,exports:mod.exports,Array,Uint8Array,ArrayBuffer,Int32Array,Uint32Array,Uint16Array,Int16Array,Int8Array,Float32Array,Float64Array,setTimeout,clearTimeout});
const P=mod.exports,N=P.PDFName.of;
const pageStreams=(d,i=0)=>{const c=d.getPage(i).node.Contents();return c instanceof P.PDFArray?c.asArray().map(r=>d.context.lookup(r)):[c];};
const runtime=Promise.all([import('../src/privacy-native-worker.js'),import('mupdf')]);
async function inspect(bytes){
 const [,M]=await runtime,d=M.Document.openDocument(bytes,'application/pdf'),texts=[];
 try{for(let i=0;i<d.countPages();i++){const p=d.loadPage(i),t=p.toStructuredText();texts.push(t.asText());t.destroy();p.destroy();}return texts;}finally{d.destroy();}
}
async function maskFor(bytes,needle){
 const [,M]=await runtime,d=M.Document.openDocument(bytes,'application/pdf'),p=d.loadPage(0),q=p.search(needle)[0][0],b=p.getBounds(),xs=q.filter((_,i)=>i%2===0),ys=q.filter((_,i)=>i%2===1),w=b[2]-b[0],h=b[3]-b[1];
 const mask=[(Math.min(...xs)-b[0]-.1)/w,(Math.min(...ys)-b[1]-.1)/h,(Math.max(...xs)-Math.min(...xs)+.2)/w,(Math.max(...ys)-Math.min(...ys)+.2)/h];p.destroy();d.destroy();return mask;
}
test('one text run loses only the masked word; remaining glyphs and vectors stay native',async()=>{
 const [engine]=await runtime,doc=await P.PDFDocument.create(),p=doc.addPage([400,300]);
 p.drawText('PUBLIC SECRET PUBLIC',{x:30,y:210,size:18});p.drawRectangle({x:20,y:20,width:40,height:30,color:P.rgb(0,1,0)});
 doc.addPage([300,500]).drawText('SECOND PAGE');const before=await doc.save(),result=await engine.process({bytes:before,masks:[[await maskFor(before,'SECRET')],[]]});
 const text=await inspect(result.bytes);assert(!text[0].includes('SECRET'));assert.equal((text[0].match(/PUBLIC/g)||[]).length,2);assert(text[1].includes('SECOND PAGE'));
 const out=await P.PDFDocument.load(result.bytes);assert.equal(out.context.enumerateIndirectObjects().filter(([,v])=>v instanceof P.PDFRawStream&&String(v.dict.get(N('Subtype')))==='/Image').length,0);
 const streams=pageStreams(out).map(r=>P.decodePDFRawStream(r).decode());assert(streams.some(b=>new TextDecoder().decode(b).includes('0 1 0 rg')),'Untouched green vector survives');
});
test('hidden text, canonical widget values, attachments and document metadata are actually discarded',async()=>{
 const [engine]=await runtime,d=await P.PDFDocument.create(),p=d.addPage([400,300]);p.drawText('SECRET',{x:30,y:210,size:18});p.drawText('PUBLIC',{x:30,y:30,size:18});
 const field=d.getForm().createTextField('PRIVATE-FIELD');field.setText('PRIVATE-VALUE');field.addToPage(p,{x:10,y:150,width:200,height:40});d.setAuthor('PRIVATE-AUTHOR');await d.attach(new TextEncoder().encode('PRIVATE-BYTES'),'private.txt');
 const out=await engine.process({bytes:await d.save(),masks:[[[0,0,1,.6]]]}),check=await P.PDFDocument.load(out.bytes),text=(await inspect(out.bytes)).join('');assert(text.includes('PUBLIC'));assert(!text.includes('SECRET')&&!text.includes('PRIVATE'));
 assert(!check.catalog.has(N('AcroForm'))&&!check.catalog.has(N('Names')));assert.notEqual(check.getAuthor(),'PRIVATE-AUTHOR');
 const all=check.context.enumerateIndirectObjects().map(([,o])=>o instanceof P.PDFRawStream?new TextDecoder().decode(P.decodePDFRawStream(o).decode()):String(o)).join('\n');assert(!/PRIVATE-(VALUE|FIELD|BYTES|AUTHOR)/.test(all));
});
test('redacted image pixels are removed from the embedded image; untouched image bytes stay identical',async()=>{
 const [engine,M]=await runtime,d=await P.PDFDocument.create(),image=new M.Pixmap(M.ColorSpace.DeviceRGB,[0,0,60,60],false);image.clear(80);const jpeg=image.asJPEG(85).slice();image.destroy();
 const embedded=await d.embedJpg(jpeg);d.addPage([300,300]).drawImage(embedded,{x:0,y:0,width:300,height:300});
 const untouched=await d.embedJpg(jpeg);d.addPage([300,300]).drawImage(untouched,{x:0,y:0,width:300,height:300});
 const out=await engine.process({bytes:await d.save(),masks:[[[.25,.25,.5,.5]],[]]}),check=await P.PDFDocument.load(out.bytes),streams=check.context.enumerateIndirectObjects().map(([,v])=>v).filter(v=>v instanceof P.PDFRawStream&&String(v.dict.get(N('Subtype')))==='/Image');
 assert.equal(streams.length,2);assert(streams.some(s=>Buffer.from(s.getContents()).equals(Buffer.from(jpeg))),'Unmasked JPEG preserved');
 const changed=streams.find(s=>String(s.dict.get(N('ColorSpace')))==='/DeviceRGB'&&String(s.dict.get(N('Filter')))!=='/DCTDecode');assert(changed,'Redacted RGB image reaches existing optimizer');
 const pixels=P.decodePDFRawStream(changed).decode(),center=(30*60+30)*3;assert(pixels[center]>240,'Covered pixels are blank in extractable image, not merely overlaid');assert(Math.abs(pixels[0]-80)<5,'Unmasked image pixels preserved');
});
test('redacting tagged ActualText does not leave a hidden replacement string',async()=>{
 const [engine]=await runtime,d=await P.PDFDocument.create(),p=d.addPage([400,300]);
 p.pushOperators(P.PDFOperator.of('/Span << /ActualText (PRIVATE-ACTUALTEXT) >> BDC'));p.drawText('SECRET',{x:30,y:210,size:18});p.pushOperators(P.PDFOperator.of('EMC'));p.drawText('PUBLIC',{x:30,y:30,size:18});
 const out=await engine.process({bytes:await d.save(),masks:[[[0,0,1,.5]]]}),check=await P.PDFDocument.load(out.bytes);
 const content=pageStreams(check).map(r=>new TextDecoder().decode(P.decodePDFRawStream(r).decode())).join('');
 assert(!content.includes('PRIVATE-ACTUALTEXT'),'Marked-content replacement text survived redaction');assert((await inspect(out.bytes))[0].includes('PUBLIC'));
});
test('invalid mask and page mapping fail rather than returning an unredacted document',async()=>{
 const [engine]=await runtime,d=await P.PDFDocument.create();d.addPage();const bytes=await d.save();
 await assert.rejects(engine.process({bytes,masks:[]}));await assert.rejects(engine.process({bytes,masks:[[[NaN,0,.2,.2]]]}));
});

test('hidden-property scanning preserves literal text, escaped parentheses and drawing commands',async()=>{
 const {stripHiddenProperties}=await import('../src/privacy-content.mjs'),encode=s=>new TextEncoder().encode(s),decode=b=>new TextDecoder().decode(b);
 for(const separator of [' ','\0','% comment\n']){
  const input='/Span << /MCID 2 /Act#75alText'+separator+'(PRIVATE \\(nested\\) (secret)) /Alt <50524956> >> BDC (PUBLIC /ActualText \\(text\\)) Tj EMC';
  const output=decode(stripHiddenProperties(encode(input)));
  assert(!output.includes('PRIVATE')&&!output.includes('50524956'));assert(output.includes('(PUBLIC /ActualText \\(text\\)) Tj'));assert(output.includes('/MCID 2'));
 }
 assert.throws(()=>stripHiddenProperties(encode('BI /W 1 /H 1 ID data EI /Span << /ActualText (secret) >> BDC EMC')));
});
