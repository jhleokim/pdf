const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const lib=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('.PDFLib='));
const moduleObject={exports:{}};vm.runInNewContext(lib,{module:moduleObject,exports:moduleObject.exports,Array,Uint8Array,ArrayBuffer,Int32Array,Uint32Array,Uint16Array,Int16Array,Int8Array,Float32Array,Float64Array,setTimeout,clearTimeout});
const P=global.PDFLib=moduleObject.exports,policy=require('../src/ocr-page-policy.js'),integrity=require('../src/document-integrity.js'),engine=require('../src/pro-engine.js');
test('scan with a digital header is recognized; digital-only page remains searchable without OCR',()=>{
 assert.equal(policy.decide({items:[{str:'1 / 6'}],hasImages:true}).action,'fill-gaps');
 assert.equal(policy.decide({items:[{str:'Digital contract'}]}).action,'skip');
 assert.equal(policy.decide({items:[],hasImages:true}).action,'recognize');
});
test('preflight finds real field widgets, attachments, metadata and signature dictionaries',async()=>{
 const doc=await P.PDFDocument.create(),page=doc.addPage();doc.getForm().createTextField('name').addToPage(page);await doc.attach(new Uint8Array([1,2,3]),'private.txt');await doc.flush();
 const sig=doc.context.obj({FT:'Sig',ByteRange:[0,1,2,3]});doc.catalog.set(P.PDFName.of('TestSignature'),sig);
 const r=integrity.inspect(doc);assert.ok(r.forms);assert.ok(r.attachments);assert.ok(r.signatures);
 assert.equal(integrity.warnings(r,{restructured:true,redacted:true}).length,3);
});
test('lossless deduplication redirects references and removes duplicate raw images',async()=>{
 const doc=await P.PDFDocument.create(),page=doc.addPage(),dict={Type:'XObject',Subtype:'Image',Width:2,Height:2,BitsPerComponent:8,ColorSpace:'DeviceRGB'};
 const a=doc.context.register(doc.context.stream(new Uint8Array(12).fill(127),dict)),b=doc.context.register(doc.context.stream(new Uint8Array(12).fill(127),dict));
 const resources=doc.context.obj({XObject:{A:a,B:b}});page.node.set(P.PDFName.of('Resources'),resources);
 const r=await engine.deduplicateImages(doc);assert.equal(r.count,1);assert.equal(r.bytes,12);
 const x=resources.lookup(P.PDFName.of('XObject'));assert.equal(x.get(P.PDFName.of('A')),x.get(P.PDFName.of('B')));
 const reopened=await P.PDFDocument.load(await doc.save());assert.equal(reopened.context.enumerateIndirectObjects().filter(([,v])=>v instanceof P.PDFRawStream&&String(v.dict.get(P.PDFName.of('Subtype')))==='/Image').length,1);
});
test('compression preflight distinguishes bitonal scans from supported RGB',async()=>{
 const doc=await P.PDFDocument.create();doc.addPage();for(const bits of [1,8])doc.context.register(doc.context.stream(new Uint8Array(12),{Type:'XObject',Subtype:'Image',Width:2,Height:2,BitsPerComponent:bits,ColorSpace:'DeviceGray'}));
 const r=await engine.analyzeDocument(doc);assert.equal(r.images,2);assert.equal(r.eligible,1);assert.equal(r.reasons.precision,1);
});
