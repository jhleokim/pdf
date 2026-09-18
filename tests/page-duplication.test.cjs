const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/page-context-menu.js'),'utf8').split('\n(()=>{')[0];
function harness(count=500,{clone=structuredClone,previewFailure=false}={}){
 const doc={libBytes:new Uint8Array(32)},pages=Array.from({length:count},(_,i)=>({uid:'p'+i,docId:'source',srcIndex:i,rotation:0,thumbRatio:.7,canvas:{width:300,height:400},annots:[{id:'a'+i,text:'Page '+i}],deskewAngle:i%2?.25:0,deskewCrop:i%2===1}));
 const key=(p,o)=>JSON.stringify([p.uid,p.annots,o.deskewAngles[p.uid],o.deskewCropByPage[p.uid]===true]);
 const options={deskewAngles:Object.fromEntries(pages.map(p=>[p.uid,p.deskewAngle])),deskewCropByPage:Object.fromEntries(pages.filter(p=>p.deskewCrop).map(p=>[p.uid,true]))};
 let busy=false,yields=0;const history=[],stagedSizes=[],classes=()=>({add(){}});
 const ctx=vm.createContext({pages,docs:new Map([['source',doc]]),uidSeq:count,annoUidSeq:count,lastClicked:null,ocrRunning:false,textUpdate:Promise.resolve(),structuredClone:clone,
   document:{body:{classList:{contains:()=>busy}}},finishTextEdit:()=>true,finishReviewStampForNavigation(){},readProOptions:()=>options,
   captureEditHistory:()=>({signature:String(ctx.pages.length),previewUid:'p0'}),captureBoardPositions:()=>new Map(),busy:on=>{busy=on;},
   ocrKey:key,ocrRecordCurrent:(r,p,o)=>r.key===key(p,o),PDFPrivacy:{maskKey:()=>''},stampMarks:[{scope:'selected',targets:['p0']}],stampAsset:null,stampEditing:null,
   ocrRecords:pages.map(p=>({uid:p.uid,key:key(p,options),text:'Contract '+p.srcIndex,words:Array.from({length:100},(_,i)=>({text:'word'+i,box:[0,0,1,1]}))})),
   progress(){},idle:async()=>{yields++;stagedSizes.push(ctx.pages.length);},render:()=>{for(const p of ctx.pages)p.el={classList:classes(),focus(){},scrollIntoView(){}};},
   syncCounts(){},toolsChanged(){},animateBoardFrom(){},showPreview:async()=>{if(previewFailure)throw Error('Preview rendering failed');},
   editHistory:{push:(...args)=>history.push(args)},collectHistoryDocuments(){},syncHistoryControls(){},toast(){}});
 vm.runInContext(source,ctx);
 return {ctx,pages,history,options,busy:()=>busy,yields:()=>yields,stagedSizes};
}
test('500 OCR-rich pages duplicate without rereading PDFs, yielding before an atomic document update',async()=>{
 const h=harness();await h.ctx.duplicatePages(h.pages);
 assert.equal(h.ctx.pages.length,1000);assert.equal(h.ctx.docs.size,1);assert.equal(h.ctx.ocrRecords.length,1000);assert.ok(h.yields()>=60);
 assert.ok(h.stagedSizes.every(n=>n===500));assert.equal(h.busy(),false);
 const copies=h.ctx.pages.slice(500);assert.ok(copies.every(p=>p.docId==='source'&&p.canvas===null));assert.notEqual(copies[0].annots,h.pages[0].annots);
 assert.notEqual(copies[0].annots[0].id,h.pages[0].annots[0].id);assert.deepEqual(Array.from(h.ctx.stampMarks[0].targets),['p0',copies[0].uid]);
 const after=h.history[0][1];assert.equal(after.pageOcr.length,500);assert.ok(after.extraBytes>1000000);assert.equal(after.previewUid,copies[0].uid);
 for(const row of after.pageOcr){const copy=copies.find(p=>p.uid===row.uid),o={deskewAngles:{[copy.uid]:copy.deskewAngle},deskewCropByPage:{[copy.uid]:copy.deskewCrop}};assert.equal(row.record.key,h.ctx.ocrKey(copy,o));}
});
test('a clone failure does not leave partially inserted pages or changed stamp targets',async()=>{
 let count=0;const h=harness(20,{clone:value=>{if(++count===7)throw Error('Clone allocation failed');return structuredClone(value);}}),beforeRecords=h.ctx.ocrRecords;
 await assert.rejects(h.ctx.duplicatePages(h.pages),/Clone allocation failed/);
 assert.equal(h.ctx.pages,h.pages);assert.equal(h.ctx.pages.length,20);assert.equal(h.ctx.ocrRecords,beforeRecords);assert.deepEqual(Array.from(h.ctx.stampMarks[0].targets),['p0']);assert.equal(h.history.length,0);assert.equal(h.busy(),false);
});
test('a preview error after duplication still leaves a complete undo transaction',async()=>{
 const h=harness(1,{previewFailure:true});await assert.rejects(h.ctx.duplicatePages(h.pages),/Preview rendering failed/);
 assert.equal(h.ctx.pages.length,2);assert.equal(h.history.length,1);assert.equal(h.history[0][0].pageOcr[0].record,null);assert.equal(h.history[0][1].pageOcr[0].record.text,'Contract 0');assert.equal(h.busy(),false);
});
