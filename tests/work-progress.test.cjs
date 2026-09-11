const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const ctx={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/work-progress.js'),'utf8'),ctx);
const {createTracker,duration}=ctx.PDFWorkProgress;
test('remaining time uses observed work and stays unknown without enough evidence',()=>{
 let time=0;const t=createTracker(()=>time);assert.equal(t.snapshot().remaining,null);time=1000;t.update(10);assert.equal(t.snapshot().remaining,null);
 time=4000;t.update(25);assert.equal(t.snapshot().remaining,12000);assert.equal(t.snapshot().percent,25);
 time=20001;assert.equal(t.snapshot().remaining,null,'stalled work must not keep promising zero seconds');
});
test('phases reset estimates without resetting elapsed time; cancel freezes progress',()=>{
 let time=0;const t=createTracker(()=>time);t.update(30);time=4000;t.update(80);t.phase('OCR',false);t.update(20);time=7000;t.update(40);
 assert.equal(t.snapshot().elapsed,7000);assert.equal(t.snapshot().remaining,null,'unknown token totals are not a time estimate');
 t.estimate(12000);time=9000;assert.equal(t.snapshot().remaining,10000);time=22000;assert.equal(t.snapshot().remaining,null);
 t.cancel();t.update(99);assert.equal(t.snapshot().percent,40);assert.equal(t.snapshot().canceled,true);
});
test('progress is monotonic, bounded and formatted in minutes and seconds',()=>{
 const t=createTracker(()=>0);t.update(60);t.update(12);t.update(NaN);assert.equal(t.snapshot().percent,60);t.update(100);assert.equal(t.snapshot().percent,99);
 assert.equal(duration(61500),'1분 02초');assert.equal(duration(3600000),'60분 00초');
});
test('unknown output stays indeterminate until measured page timings are available',()=>{
 let time=0;const t=createTracker(()=>time);t.phase('OCR',false);time=10000;
 assert.equal(t.snapshot().indeterminate,true);assert.equal(t.snapshot().remaining,null);
 t.plan(0,95,20000);t.estimate(20000);time=20000;
 assert.equal(t.snapshot().percent,47);assert.equal(t.snapshot().estimated,true);assert.equal(t.snapshot().remaining,10000);
 time=40000;assert.equal(t.snapshot().percent,90);assert.equal(t.snapshot().remaining,null,'overruns require a new estimate');
 t.cancel();time=50000;assert.equal(t.snapshot().percent,90,'cancel freezes projected progress too');
});
test('only bounded successful page timings are saved and reused',()=>{
 const stored=new Map(),context={localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/work-progress.js'),'utf8'),context);
 const p=context.PDFWorkProgress;p.sample('paddle',20000);p.sample('paddle',40000);assert.equal(p.previous('paddle'),30000);
 for(const invalid of [NaN,Infinity,-1,100,600001])p.sample('paddle',invalid);
 assert.equal(p.previous('paddle'),30000);assert.deepEqual(JSON.parse(stored.get('pdf-ocr-timings-v1')),{paddle:30000});
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/work-progress.js'),'utf8'),context);
 assert.equal(context.PDFWorkProgress.previous('paddle'),30000);assert.equal(context.PDFWorkProgress.previous('missing'),null);
});
