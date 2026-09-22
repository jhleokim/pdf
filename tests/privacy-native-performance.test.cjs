const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const code=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('.PDFLib='));
const ctx=vm.createContext({setTimeout,Array,Uint8Array,ArrayBuffer});vm.runInContext(code,ctx);const P=ctx.PDFLib;

test('500-page sparse redaction coalesces timers, completes progress and preserves all public native text',{timeout:20000},async()=>{
 const [engine,M]=await Promise.all([import('../src/privacy-native-worker.js'),import('mupdf')]);
 const d=await P.PDFDocument.create(),font=await d.embedFont(P.StandardFonts.Helvetica),masks=[];
 for(let i=0;i<500;i++){const p=d.addPage([400,300]);p.drawText('PRIVATE '+i,{x:30,y:240,size:18,font});p.drawText('PUBLIC PAGE '+i,{x:30,y:30,size:18,font});masks.push(i===250?[[0,0,1,.4]]:[]);}
 d.setAuthor('CONFIDENTIAL AUDIT AUTHOR');const bytes=await d.save(),progress=[];
 const clock=global.performance,timer=global.setTimeout,render=M.PDFPage.prototype.toPixmap;let ticks=0,yields=0,rasterizations=0,result;
 try{
  // A deterministic elapsed-work clock tests scheduling independently of host
  // timer granularity, CPU load and the CI machine's total execution time.
  global.performance={now:()=>++ticks};global.setTimeout=(fn,ms,...args)=>{assert.equal(ms,0);yields++;return setImmediate(fn,...args);};
  M.PDFPage.prototype.toPixmap=function(...args){rasterizations++;return render.apply(this,args);};
  result=await engine.process({bytes,masks},(done,total)=>progress.push([done,total]));
 }finally{global.performance=clock;global.setTimeout=timer;M.PDFPage.prototype.toPixmap=render;}
 assert.ok(yields>=20&&yields<=22,'time slices replace 500 individual timer ticks');assert.equal(progress.length,yields);assert.equal(rasterizations,0);assert.equal(result.maskedPages,1);
 assert.deepEqual(progress.at(-1),[500,500]);assert.ok(progress.every(([done,total],i)=>total===500&&done>(progress[i-1]?.[0]||0)));
 const out=M.Document.openDocument(result.bytes,'application/pdf');
 try{assert.equal(out.countPages(),500);for(let i=0;i<500;i++){const p=out.loadPage(i),text=p.toStructuredText();try{const str=text.asText();assert.ok(str.includes('PUBLIC PAGE '+i));assert.equal(str.includes('PRIVATE '+i),i!==250);}finally{text.destroy();p.destroy();}}}finally{out.destroy();}
 const clean=await P.PDFDocument.load(result.bytes);assert.notEqual(clean.getAuthor(),'CONFIDENTIAL AUDIT AUTHOR');
 assert.equal(clean.context.enumerateIndirectObjects().filter(([,o])=>o instanceof P.PDFRawStream&&String(o.dict.get(P.PDFName.of('Subtype')))==='/Image').length,0);
});

test('a fast no-mask final sanitization yields only once and still removes hidden document metadata',async()=>{
 const [engine]=await Promise.all([import('../src/privacy-native-worker.js')]);const d=await P.PDFDocument.create();for(let i=0;i<100;i++)d.addPage([100,100]);d.setAuthor('PRIVATE');
 const bytes=await d.save(),clock=global.performance,timer=global.setTimeout,progress=[];let yields=0,result;
 try{global.performance={now:()=>0};global.setTimeout=(fn,ms)=>{assert.equal(ms,0);yields++;return setImmediate(fn);};result=await engine.process({bytes,masks:Array.from({length:100},()=>[])},(n,total)=>progress.push([n,total]));}
 finally{global.performance=clock;global.setTimeout=timer;}
 assert.equal(yields,1);assert.deepEqual(progress,[[100,100]]);const out=await P.PDFDocument.load(result.bytes);assert.equal(out.getPageCount(),100);assert.notEqual(out.getAuthor(),'PRIVATE');
});
