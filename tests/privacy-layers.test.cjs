const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),code=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('.PDFLib='));
const mod={exports:{}};vm.runInNewContext(code,{module:mod,exports:mod.exports,Array,Uint8Array,ArrayBuffer,Int32Array,Uint32Array,Uint16Array,Int16Array,Int8Array,Float32Array,Float64Array,setTimeout,clearTimeout});
const P=mod.exports,N=P.PDFName.of,runtime=Promise.all([import('../src/privacy-native-worker.js'),import('mupdf')]);
async function layered(){
 const doc=await P.PDFDocument.create(),page=doc.addPage([400,300]);page.drawText('PUBLIC',{x:30,y:30,size:18});doc.addPage([400,300]);
 const layer=doc.context.register(doc.context.obj({Type:'OCG',Name:P.PDFString.of('Hidden layer')}));
 doc.catalog.set(N('OCProperties'),doc.context.obj({OCGs:[layer],D:{BaseState:'ON',OFF:[layer]}}));
 page.node.Resources().set(N('Properties'),doc.context.obj({Hidden:layer}));
 page.pushOperators(P.PDFOperator.of('/OC /Hidden BDC'));page.drawText('SECRET-HIDDEN-LAYER',{x:30,y:210,size:18});page.pushOperators(P.PDFOperator.of('EMC'));
 return doc;
}
async function text(bytes){const [,M]=await runtime,doc=M.Document.openDocument(bytes,'application/pdf'),page=doc.loadPage(0),value=page.toStructuredText();try{return value.asText();}finally{value.destroy();page.destroy();doc.destroy();}}
function client(){let loads=0,calls=0;const context=vm.createContext({PDFLib:{...P,PDFDocument:{load:async bytes=>{loads++;return P.PDFDocument.load(bytes);}}},PDFPrivacyNative:{run:async()=>{calls++;throw Error('unexpected native call');}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/privacy-export.js'),'utf8'),context);
 return {api:context.PDFPrivacy,get loads(){return loads;},get calls(){return calls;}};
}
function buildClient(sources){
 let loads=0,copies=0;
 const library={load:async bytes=>{loads++;return P.PDFDocument.load(bytes);},create:async()=>{
  const doc=await P.PDFDocument.create(),copy=doc.copyPages.bind(doc);doc.copyPages=async(source,indices)=>{copies++;return copy(source,Array.from(indices));};return doc;
 }};
 const context=vm.createContext({PDFLib:{...P,PDFDocument:library},PDFDocument:library,degrees:P.degrees,docs:sources,idle:async()=>{},bakeAnnots:async()=>{}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/privacy-export.js'),'utf8'),context);
 const editor=fs.readFileSync(path.join(__dirname,'../src/editor.js'),'utf8');
 vm.runInContext(editor.slice(editor.indexOf('async function buildEditedDocument('),editor.indexOf('function downloadPdf(')),context);
 return {build:pages=>context.buildEditedDocument(pages),api:context.PDFPrivacy,get loads(){return loads;},get copies(){return copies;}};
}
const row=(docId,index,uid)=>({uid,docId,srcIndex:index,rotation:0,annots:[]});

test('native redaction rejects optional layers before making hidden content visible',async()=>{
 const doc=await layered(),bytes=await doc.save(),[engine]=await runtime;
 assert.equal(await text(bytes),'PUBLIC\n\n','The source default layer state really hides the sensitive text');
 await assert.rejects(engine.process({bytes,masks:[[[.9,.9,.05,.05]],[]]}),/레이어 표시 설정/);
 assert.equal(await text(bytes),'PUBLIC\n\n','The source bytes remain unchanged after rejection');
});

test('masked page copies are blocked using original layer state before native export or cloud OCR preparation',async()=>{
 const original=await layered(),source={libBytes:await original.save()},out=await P.PDFDocument.create();out.addPage((await out.copyPages(original,[0]))[0]);
 assert.equal(out.catalog.has(N('OCProperties')),false,'Page copying drops the visibility configuration');
 assert.match(await text(await out.save()),/SECRET-HIDDEN-LAYER/,'The copied page would expose previously hidden content');
 const h=client(),pages=[{uid:1,docId:'source',srcIndex:0,annots:[{shape:'redaction',nx:.9,ny:.9,nw:.05,nh:.05}]}],sources=new Map([['source',source]]);
 await assert.rejects(h.api.redact(out,pages,{sources}),error=>error.code==='PRIVACY_OPTIONAL_CONTENT');
 await assert.rejects(h.api.assertSupportedSources(pages,sources),error=>error.code==='PRIVACY_OPTIONAL_CONTENT');
 assert.equal(h.calls,0,'No bytes reach the native/output pipeline');assert.equal(h.loads,1,'Only a boolean layer check is cached for this source');
});

test('a masked merged document checks layer state on its unmasked sources too; normal export stays unchanged',async()=>{
 const doc=await layered(),plain=await P.PDFDocument.create();plain.addPage();
 const list=[{docId:'plain',annots:[{shape:'redaction'}]},{docId:'layered',annots:[]}],sources=new Map([['plain',{libBytes:await plain.save()}],['layered',{libBytes:await doc.save()}]]),h=client();
 await assert.rejects(h.api.redact(doc,list,{sources}),error=>error.code==='PRIVACY_OPTIONAL_CONTENT');assert.equal(h.calls,0);
 assert.equal(await h.api.redact(doc,[list[1]],{sources}),doc,'Without masking the existing export policy is retained');
});

test('ordinary subset and repeated-page builds reuse the loaded no-layer source and cached check',async()=>{
 const doc=await P.PDFDocument.create();doc.addPage([400,300]).drawText('PUBLIC');doc.addPage([400,300]);
 const source={libBytes:await doc.save(),count:2},h=buildClient(new Map([['plain',source]]));
 const subset=await h.build([row('plain',0,1)]);assert.match(await text(await subset.save()),/PUBLIC/);assert.equal(h.loads,1);assert.equal(h.copies,1);
 await h.api.assertSupportedSource(source,undefined,{catalog:{has(){throw Error('The completed source check was not cached');}}});
 const copies=await h.build([row('plain',0,1),row('plain',0,2)]);assert.equal(copies.getPageCount(),2);assert.equal(h.loads,2,'No second parse is added by either safety check');assert.equal(h.copies,3);
});

for(const mode of ['subset','repeated','merged'])test('unmasked '+mode+' builds reject optional layers before copying their content',async()=>{
 const layeredDoc=await layered(),plain=await P.PDFDocument.create();plain.addPage();
 const source={libBytes:await layeredDoc.save(),count:2},h=buildClient(new Map([['layered',source],['plain',{libBytes:await plain.save(),count:1}]]));
 const rows=[row('layered',0,1)];if(mode==='repeated')rows.push(row('layered',0,2));if(mode==='merged')rows.push(row('plain',0,2));
 await assert.rejects(h.build(rows),error=>error.code==='PRIVACY_OPTIONAL_CONTENT'&&error.message.includes('필요한 레이어만'));
 assert.equal(h.copies,0);assert.equal(h.loads,1,'Guard uses the already parsed original source');assert.equal(await text(source.libBytes),'PUBLIC\n\n');
});

test('a complete unmasked single-source export retains layer configuration and original visible content',async()=>{
 const original=await layered(),h=buildClient(new Map([['layered',{libBytes:await original.save(),count:2}]]));
 const out=await h.build([row('layered',0,1),row('layered',1,2)]);
 assert.equal(out.catalog.has(N('OCProperties')),true);assert.equal(await text(await out.save()),'PUBLIC\n\n');assert.equal(h.copies,0);assert.equal(h.loads,1);
});
