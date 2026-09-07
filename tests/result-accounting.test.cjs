const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../src/pro-result.js');
const opts={optimize:true,grayscale:false,contrast:0,whitePoint:255,crop:false,paper:'original',number:false,watermark:''};
const bytes=n=>new Uint8Array(n);
test('size savings include structural compression relative to the unchanged input file',()=>{
 const r=R.selectOutput(bytes(900),bytes(850),opts,bytes(1000));
 assert.equal(r.reference.length,1000);assert.equal(r.bytes.length,850);assert.ok(Math.abs(r.reduction-15)<1e-9);assert.equal(r.structureSaved,100);
});
test('only a complete unedited PDF can supply the original comparison baseline',()=>{
 const original=bytes(1000),docs=new Map([['d',{count:2,kind:'pdf',libBytes:original}]]);
 const p=[0,1].map(srcIndex=>({srcIndex,docId:'d',rotation:0,annots:[]}));
 assert.equal(R.unchangedSource(p,docs),original);
 for(const changed of [p.slice(0,1),[p[1],p[0]],[{...p[0],rotation:90},p[1]],[{...p[0],annots:[{}]},p[1]],[p[0],{...p[1],docId:'other'}]])assert.equal(R.unchangedSource(changed,docs),null);
 assert.equal(R.unchangedSource(p,new Map([['d',{count:2,kind:'image',libBytes:original}]])),null);
});
test('compression-only output never grows and preserves the smallest valid baseline',()=>{
 const original=bytes(800),before=bytes(900),candidate=bytes(950);
 assert.equal(R.selectOutput(before,candidate,opts,original).bytes,original);
 assert.equal(R.selectOutput(before,candidate,opts,null).bytes,before);
 assert.equal(R.selectOutput(bytes(700),candidate,opts,original).bytes.length,700);
});
test('enhancement, crop, numbering and watermark settings are never discarded to reduce size',()=>{
 for(const extra of [{blackWhite:true},{deskew:true},{grayscale:true},{contrast:10},{whitePoint:220},{crop:true},{paper:'a4'},{number:true},{watermark:'Copy'}]){
  const r=R.selectOutput(bytes(900),bytes(1200),{...opts,...extra},bytes(1000));assert.equal(r.bytes.length,1200);assert.equal(r.retained,false);
 }
});

test('whole-page compression also retains the baseline if it is smaller, unless a visual change was requested',()=>{
 const original=bytes(800),candidate=bytes(1200);
 const r=R.selectOutput(bytes(900),candidate,{...opts,rasterize:true},original);
 assert.equal(r.bytes,original);assert.equal(r.retained,true);
 assert.equal(R.selectOutput(bytes(900),candidate,{...opts,rasterize:true,blackWhite:true},original).bytes,candidate);
});
