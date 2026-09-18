const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/editor.js'),'utf8');
function harness(specs){
 const nodes=new Map(),flags=new Set(),state={starts:0,stops:0,errors:[],history:0,renders:0,opened:[]};
 const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:id==='busyCancel',onclick:null,textContent:'',classList:{toggle(){}}});return nodes.get(id);};
 const c=vm.createContext({AbortController,Uint8Array,Set,Map,console:{error:e=>state.errors.push(e)},
  document:{body:{classList:{contains:s=>flags.has(s),toggle:(s,on)=>on?flags.add(s):flags.delete(s)}}},$,syncLeaveWarning(){},
  PDFWorkProgress:{start:()=>state.starts++,stop:()=>state.stops++},idle:async()=>{},isPdf:()=>true,isImage:()=>false,toast(){},
  pages:[],docs:new Map(),docSeq:0,uidSeq:0,origCount:0,SWATCH:['green'],DOC_OPTS:{},previewUid:'old',textUpdate:Promise.resolve(),finishTextEdit:()=>true,
  captureEditHistory:()=>({}),commitEditHistory:()=>state.history++,render:()=>state.renders++,showPreview(){},progress(){},
  pdfjsLib:{getDocument(){const spec=specs.shift(),entry={destroyed:0},pdf={numPages:spec.pages||5,getPage:async i=>{await spec.onPage?.(i,c,$);if(i===spec.fail)throw Error('corrupt page');return {getViewport:()=>({width:600,height:800})};}};const task={promise:spec.reject?Promise.reject(Error('corrupt header')):Promise.resolve(pdf),destroy:async()=>{entry.destroyed++;}};state.opened.push(entry);return task;}}});
 vm.runInContext(source.slice(source.indexOf('const busy ='),source.indexOf('const buzz =')),c);
 vm.runInContext(source.slice(source.indexOf('let importController='),source.indexOf('async function renderThumb')),c);
 const file=name=>({name,arrayBuffer:async()=>new Uint8Array(10).buffer});
 return {c,state,$,load:(names=['doc.pdf'])=>c.loadFiles(names.map(file)),busy:()=>flags.has('is-busy')};
}
test('import commits only complete files and disposes a partially readable PDF',async()=>{
 const h=harness([{pages:3},{pages:8,fail:6},{pages:2}]);await h.load(['one.pdf','bad.pdf','two.pdf']);
 assert.equal(h.c.pages.length,5);assert.equal(h.c.docs.size,2);assert.equal(h.c.origCount,5);assert.equal(h.state.opened[1].destroyed,1);assert.equal(h.state.opened[0].destroyed,0);assert.equal(h.state.history,1);assert.equal(h.busy(),false);assert.equal(h.$('busyCancel').hidden,true);
});
test('cancel interrupts page metadata loading, retaining existing and completed files only',async()=>{
 const h=harness([{pages:2},{pages:40,onPage:(i,c,$)=>{if(i===5)$('busyCancel').onclick();}},{pages:10}]);await h.load(['complete.pdf','cancel.pdf','never-opened.pdf']);
 assert.equal(h.c.pages.length,2);assert.equal(h.c.docs.size,1);assert.equal(h.c.origCount,2);assert.equal(h.state.opened.length,2);assert.ok(h.state.opened[1].destroyed>=1);assert.equal(h.state.errors.length,0);assert.equal(h.busy(),false);
});
test('simultaneous imports are serialized before awaiting text editing',async()=>{
 let release;const h=harness([{pages:2}]);h.c.textUpdate=new Promise(r=>release=r);const first=h.load();await h.load(['ignored.pdf']);assert.equal(h.state.opened.length,0);release();await first;assert.equal(h.c.pages.length,2);assert.equal(h.state.opened.length,1);
});
test('repeated page progress labels do not restart the work timer',async()=>{
 const h=harness([{pages:30}]);await h.load();assert.equal(h.state.starts,1);assert.equal(h.state.stops,1);
});

test('import re-enables cancellation after a cancelled Pro job and restores ownership',async()=>{
 const h=harness([{pages:10,onPage:(i,c,$)=>{assert.equal($('busyCancel').disabled,false);if(i===3)$('busyCancel').onclick();}}]);
 const prior=()=>{};Object.assign(h.$('busyCancel'),{disabled:true,hidden:true,onclick:prior});await h.load();
 assert.equal(h.c.pages.length,0);assert.equal(h.$('busyCancel').disabled,true);assert.equal(h.$('busyCancel').onclick,prior);
});

test('an import that loses busy ownership does not overwrite another job cancellation',async()=>{
 let release;const h=harness([]);h.c.textUpdate=new Promise(r=>release=r);const pending=h.load();
 const other=()=>{};h.c.document.body.classList.toggle('is-busy',true);Object.assign(h.$('busyCancel'),{disabled:false,hidden:false,onclick:other});release();await pending;
 assert.equal(h.$('busyCancel').hidden,false);assert.equal(h.$('busyCancel').onclick,other);assert.equal(h.busy(),true);assert.equal(h.state.opened.length,0);
});
test('failed loading tasks are disposed and a later import still works',async()=>{
 const h=harness([{reject:true},{pages:2}]);await h.load();assert.equal(h.state.opened[0].destroyed,1);assert.equal(h.c.pages.length,0);await h.load();assert.equal(h.c.pages.length,2);assert.equal(h.busy(),false);
});
test('thumbnail success and failure release PDF page resources and failed canvas pixels',async()=>{
 for(const fails of [false,true]){let cleaned=0;const canvas={width:0,height:0,getContext:()=>({})};const c=vm.createContext({window:{devicePixelRatio:1},document:{createElement:()=>canvas}});vm.runInContext(source.slice(source.indexOf('async function renderThumb'),source.indexOf('function render(){')),c);
  const pdf={getPage:async()=>({getViewport:()=>({width:300,height:400}),render:()=>({promise:fails?Promise.reject(Error('render failed')):Promise.resolve()}),cleanup:()=>cleaned++})};
  if(fails){await assert.rejects(c.renderThumb(pdf,1));assert.equal(canvas.width*canvas.height,0);}else assert.equal(await c.renderThumb(pdf,1),canvas);assert.equal(cleaned,1);
 }
});
