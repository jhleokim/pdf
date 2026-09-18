'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
const editor=fs.readFileSync(path.join(root,'src/editor.js'),'utf8');
const context=vm.createContext({console,setTimeout,clearTimeout,TextEncoder,TextDecoder,URL,URLSearchParams,Blob,ReadableStream,WritableStream,TransformStream,
 AbortController,AbortSignal,atob,btoa,DOMException,ArrayBuffer,Uint8Array,Uint8ClampedArray,Int8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,DataView,test,assert});
for(const marker of ['sourceMappingURL=pdf-lib.min.js.map','pdfjs-dist/build/pdf"]','pdfjs-dist/build/pdf.worker']){
 const script=scripts.find(s=>s.includes(marker));assert.ok(script,marker);vm.runInContext(script,context);
}
vm.runInContext(`const {PDFDocument,degrees}=PDFLib;let pages=[],docs=new Map();const PDFPrivacy={isMasked:()=>false,clearCache(){},assertSupportedSource:async()=>{},redact:async doc=>doc};const idle=async()=>{};
 async function bakeAnnots(doc,page,state){for(const a of state.annots)page.drawText(a.text,{x:35,y:400,size:12});}`,context);
vm.runInContext(editor.slice(editor.indexOf('async function buildEditedDocument('),editor.indexOf('function downloadPdf(')),context);
vm.runInContext(fs.readFileSync(path.join(root,'src/pro-document.js'),'utf8'),context);
function defineTests(){
 const P=PDFLib;
 async function source(){const doc=await P.PDFDocument.create();doc.addPage([400,600]).drawText('ORIGINAL',{x:35,y:500,size:18});docs=new Map([['source',{libBytes:await doc.save(),count:1}]]);}
 async function textRows(doc){
  const task=pdfjsLib.getDocument({data:await doc.save(),disableFontFace:true,useSystemFonts:true}),pdf=await task.promise;
  try{const rows=[];for(let i=1;i<=pdf.numPages;i++)rows.push((await(await pdf.getPage(i)).getTextContent()).items.map(item=>item.str).join(' '));return rows;}
  finally{await task.destroy();}
 }
 test('saving duplicate source pages keeps a Basic edit on only its intended copy',async()=>{
  await source();pages=[{uid:'original',docId:'source',srcIndex:0,rotation:0,annots:[{text:'FIRST COPY ONLY'}]},{uid:'copy',docId:'source',srcIndex:0,rotation:0,annots:[]}];
  const rows=await textRows(await buildEditedDocument(pages));
  assert.equal(rows.length,2);assert.ok(rows[0].includes('FIRST COPY ONLY'));assert.ok(rows[1].includes('ORIGINAL'));assert.ok(!rows[1].includes('FIRST COPY ONLY'),rows[1]);
 });
 test('Pro numbering on duplicated source pages writes one distinct number per output page',async()=>{
  await source();pages=[0,1].map(i=>({uid:'p'+i,docId:'source',srcIndex:0,rotation:0,annots:[]}));
  const doc=await buildEditedDocument(pages);
  await PDFProDocument.applyDocument(doc,{crop:false,paper:'original',number:true,startNumber:97,skipPages:0,numberPosition:'bottom-center',watermark:''});
  const rows=await textRows(doc);
  assert.ok(rows[0].includes('97'));assert.ok(!rows[0].includes('98'),rows[0]);assert.ok(rows[1].includes('98'));assert.ok(!rows[1].includes('97'),rows[1]);
 });
}
vm.runInContext(`(${defineTests.toString()})();`,context);
