const test=require('node:test'),assert=require('node:assert/strict');
const {maskKey,currentOCR,nativeRecord}=require('../src/privacy-export.js');
const policy=require('../src/ocr-page-policy.js');
test('redacted digital pages require fresh OCR, without suppressing remaining text',()=>{
 assert.deepEqual(policy.decide({items:[{str:'Existing digital contract'}],force:true}),{action:'recognize',preserveExisting:false});
});
test('only OCR from this exact mask and page may enter a private export',()=>{
 const p={uid:'p1',docId:'d1',srcIndex:0,rotation:0,annots:[{shape:'redaction',nx:.1,ny:.2,nw:.3,nh:.1}]};
 const r={uid:p.uid,privacyKey:maskKey(p),words:[{text:'PUBLIC',box:[0,.1,.9,.4]}]};
 assert.ok(currentOCR(r,p),'A fresh line spanning the mask retains visible text');
 for(const change of [{docId:'d2'},{uid:'p2'},{srcIndex:1},{rotation:90},{annots:[{...p.annots[0],nx:.11}]}])assert.ok(!currentOCR(r,{...p,...change}));
 assert.ok(!currentOCR({...r,privacyKey:null},p),'Legacy or pre-mask results are refused');
 assert.ok(!currentOCR({...r,words:[]},p));
});
test('native search text retains baseline and advance for normal and rotated pages',()=>{
 const item={str:'PUBLIC',transform:[12,0,0,12,20,80],width:42};
 const normal=nativeRecord({items:[item]},{width:200,height:100,transform:[1,0,0,-1,0,100]},'p');
 assert.deepEqual(normal.words[0].nativeBasis,[.1,.2,.21,0,0,-.12]);
 const rotated=nativeRecord({items:[item]},{width:100,height:200,transform:[0,1,1,0,0,0]},'p');
 assert.deepEqual(rotated.words[0].nativeBasis,[.8,.1,0,.21,.12,0]);
 assert.equal(normal.words[0].text,'PUBLIC');
});
test('malformed and empty extracted items never create invalid text matrices',()=>{
 const record=nativeRecord({items:[{str:' '},{str:'broken',transform:[NaN,0,0,10,0,0],width:10},{str:'zero',transform:[0,0,0,12,0,0],width:10}]},{width:200,height:100,transform:[1,0,0,-1,0,100]},'p');
 assert.deepEqual(record.words,[]);
});
