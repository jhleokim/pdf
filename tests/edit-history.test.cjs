const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/edit-history.js'),'utf8');
const code=source.slice(source.indexOf('class EditHistoryStack'),source.indexOf('const editHistory='));
function stack(limit=50,budget=8388608,sourceBudget){const context=vm.createContext({Date});vm.runInContext(code+';this.Stack=EditHistoryStack;',context);return new context.Stack(limit,budget,sourceBudget);}
const state=n=>({signature:String(n),value:n});
test('history preserves chronological undo/redo and drops redo only after an actual new edit',()=>{
 const h=stack();h.push(state(0),state(1),'one');h.push(state(1),state(2),'two');assert.equal(h.take().state.value,1);assert.equal(h.take().state.value,0);assert.equal(h.take(true).state.value,1);
 assert.equal(h.push(state(1),state(1),'no-op'),false);assert.equal(h.redo.length,1);h.push(state(1),state(3),'branch');assert.equal(h.redo.length,0);assert.equal(h.take().state.value,1);
});
test('continuous changes coalesce only across contiguous states with the same control',()=>{
 const h=stack();h.push(state(0),state(1),'size','size');h.push(state(1),state(2),'size','size');assert.equal(h.undo.length,1);assert.equal(h.take().state.value,0);h.take(true);h.push(state(2),state(3),'size','size');assert.equal(h.undo.length,2);
 h.push(state(7),state(8),'size','size');assert.equal(h.undo.length,3);h.push(state(8),state(9),'color','color');assert.equal(h.undo.length,4);
});
test('returning a slider to its original value does not leave an empty undo action',()=>{
 const h=stack();h.push(state(0),state(1),'size','size');h.push(state(1),state(0),'size','size');assert.equal(h.undo.length,0);
});
test('entry count and metadata budget are bounded while retaining the latest operation',()=>{
 const h=stack(3);for(let i=0;i<10;i++)h.push(state(i),state(i+1),'edit');assert.equal(h.undo.length,3);assert.equal(h.take().state.value,9);
 const b=stack(50,20);b.push(state('aaaa'),state('bbbb'),'first');b.push(state('bbbb'),state('cccc'),'second');assert.equal(b.undo.length,1);assert.equal(b.take().label,'second');b.clear();assert.equal(b.redo.length,0);
});

test('large retired PDF sources evict old undo entries while shared active bytes are not double-counted',()=>{
 const a={libBytes:{byteLength:80}},b={libBytes:{byteLength:80}},c={libBytes:{byteLength:1000}},h=stack(50,8388608,100);
 const snapshot=(signature,sources)=>({signature,sources:sources.map((d,i)=>[i,d])});
 h.push(snapshot('a',[a]),snapshot('b',[b]),'first conversion');
 h.push(snapshot('b',[b]),snapshot('c',[c]),'second conversion');
 assert.equal(h.undo.length,1);assert.equal(h.take().label,'second conversion');h.take(true);
 h.push(snapshot('c',[c]),snapshot('d',[c]),'active edit');assert.equal(h.undo.length,2);
 const latest=stack(50,8388608,10);latest.push(snapshot('a',[a]),snapshot('b',[b]),'large conversion');assert.equal(latest.undo.length,1);
});

test('large OCR snapshot payloads count against history metadata budget',()=>{
 const h=stack(50,100);h.push(state('a'),{signature:'b',extraBytes:80},'OCR duplication');h.push(state('b'),state('c'),'edit');
 assert.equal(h.undo.length,2);h.push(state('c'),{signature:'d',extraBytes:30},'second OCR duplication');assert.equal(h.undo.length,2);assert.equal(h.undo[0].label,'edit');
});

test('removed source PDFs survive undo, disappear from future snapshots and are destroyed after eviction',async()=>{
 const destroyed=[],a={name:'a',libBytes:new Uint8Array(16),pdfjsDoc:{destroy:async()=>destroyed.push('a')}},b={name:'b',libBytes:new Uint8Array(16),pdfjsDoc:{destroy:async()=>destroyed.push('b')}};
 const page={uid:'p',docId:'a',rotation:0},docs=new Map([['a',a],['b',b]]);
 const ctx=vm.createContext({Date,structuredClone,docs,pages:[page],origCount:1,previewUid:null,selAnno:null,selected:()=>[],syncHistoryControls(){}});
 vm.runInContext(source.slice(0,source.indexOf('function deferHistoryEdit'))+';this.history=editHistory;',ctx);
 const before=ctx.captureEditHistory();assert.deepEqual(Array.from(before.sources,([id])=>id),['a']);
 ctx.pages=[];ctx.commitEditHistory(before,'delete');assert.equal(docs.size,0);await new Promise(r=>setImmediate(r));assert.deepEqual(destroyed,['b']);
 assert.equal(ctx.history.undo[0].before.sources[0][1],a);assert.equal(ctx.captureEditHistory().sources.length,0);
 ctx.clearEditHistory();await new Promise(r=>setImmediate(r));assert.deepEqual(destroyed,['b','a']);
});

test('orphan OCR pruning retains current, undo and redo pages until their last history reference expires',()=>{
 const records=['orphan','current','undo','redo-before','redo-after'].map(uid=>({uid,words:[{text:uid}]}));
 const chooser={value:'1'};let renders=0,texts=0;
 const ctx=vm.createContext({Date,structuredClone,docs:new Map(),pages:[{uid:'current'}],origCount:1,previewUid:null,selAnno:null,selected:()=>[],syncHistoryControls(){},
   ocrRecords:records,$:()=>chooser,renderOCRResults(){renders++;chooser.value='';},renderOCRText(){texts++;}});
 vm.runInContext(source.slice(0,source.indexOf('function deferHistoryEdit'))+';this.history=editHistory;',ctx);
 const snapshot=uid=>({sources:[],rows:[{page:{uid}}]});
 ctx.history.undo.push({before:snapshot('undo'),after:snapshot('current')});ctx.history.redo.push({before:snapshot('redo-before'),after:snapshot('redo-after')});
 ctx.collectHistoryDocuments();assert.deepEqual(Array.from(ctx.ocrRecords,r=>r.uid),['current','undo','redo-before','redo-after']);assert.equal(chooser.value,'0');assert.equal(renders,1);assert.equal(texts,1);
 const unchanged=ctx.ocrRecords;ctx.collectHistoryDocuments();assert.equal(ctx.ocrRecords,unchanged);assert.equal(renders,1);
 ctx.history.undo=[];ctx.collectHistoryDocuments();assert.deepEqual(Array.from(ctx.ocrRecords,r=>r.uid),['current','redo-before','redo-after']);
 ctx.clearEditHistory();assert.deepEqual(Array.from(ctx.ocrRecords,r=>r.uid),['current']);assert.equal(ctx.ocrRecords[0],records[1]);
 ctx.pages=[];ctx.collectHistoryDocuments();assert.equal(ctx.ocrRecords.length,0);
});
