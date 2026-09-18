const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/pro-ui.js'),'utf8');
const code=source.slice(source.indexOf('let proTransferPending='),source.indexOf('function proNumberInput('));
function harness({previewFailure=false,pageFailure=false}={}){
 const originalPage={uid:'p1',docId:'old',srcIndex:0,rotation:0,annots:[{shape:'text',text:'EDITED'}]},originalSource={name:'source.pdf'},history=[],events=[],messages=[];
 let destroyed=0,finished=0;
 const pdf={async getPage(){if(pageFailure)throw new Error('unreadable page');return {getViewport:()=>({width:400,height:600})};},async destroy(){destroyed++;}};
 const ctx=vm.createContext({console:{error(){}},document:{body:{classList:{contains:()=>false}}},pages:[originalPage],docs:new Map([['old',originalSource]]),previewUid:'p1',docSeq:0,proModeRequest:1,proControlIds:[],SWATCH:['teal'],DOC_OPTS:{},mode:'pro',tools:'edited',
  selected:()=>ctx.pages.filter(p=>p.uid==='p1'),captureEditHistory:()=>({rows:ctx.pages.slice(),sources:[...ctx.docs],previewUid:ctx.previewUid}),captureProTransferSettings:()=>({mode:ctx.mode,tools:ctx.tools}),
  createProResult:async()=>({bytes:new Uint8Array([1,2,3]),hasPageEffects:true}),startProWork:()=>events.push('start'),finishProWork:()=>finished++,checkProAbort(){},
  pdfjsLib:{getDocument:()=>({promise:Promise.resolve(pdf)})},PDFSource:{page:p=>({id:p.docId,name:'source.pdf',index:p.srcIndex})},progress(){},idle:async()=>{},
  pdfFilename:name=>name,suggestedPdfFilename:()=> 'edited',$:()=>({value:'edited'}),clearPreview:()=>ctx.previewUid=null,resetTools:()=>ctx.tools='reset',refreshProControls(){},proInvalidate(){},
  displayProMode:mode=>ctx.mode=mode,render:()=>ctx.pages.forEach(p=>p.el={classList:{toggle(){}}}),syncCounts(){},
  editHistory:{push(before,after,label){history.push({before,after,label});events.push('commit');}},collectHistoryDocuments(){},syncHistoryControls(){},
  showPreview:async()=>{events.push('preview');assert.equal(history.length,1,'undo transaction exists before preview starts');if(previewFailure)throw new Error('canvas allocation failed');},
  toast:(message,error)=>messages.push({message,error})});
 vm.runInContext(code,ctx);
 return {ctx,history,events,messages,originalPage,originalSource,run:()=>ctx.transferProToBasic(1),get destroyed(){return destroyed;},get finished(){return finished;}};
}
test('Pro to Basic commits the old/new document and settings before awaiting preview',async()=>{
 const h=harness();assert.equal(await h.run(),true);assert.deepEqual(h.events,['start','commit','preview']);assert.equal(h.history[0].before.rows[0],h.originalPage);
 assert.equal(h.history[0].before.sources[0][1],h.originalSource);assert.equal(h.history[0].before.proTransfer.tools,'edited');assert.equal(h.history[0].after.proTransfer.mode,'basic');
 assert.equal(h.ctx.pages[0].docId,'d1');assert.equal(h.ctx.pages[0].annots.length,0);assert.equal(h.ctx.docs.has('d1'),true);assert.equal(h.finished,1);assert.equal(h.destroyed,0);
});
test('failed Basic preview preserves the published conversion and its usable undo snapshot',async()=>{
 const h=harness({previewFailure:true});assert.equal(await h.run(),true);assert.equal(h.ctx.mode,'basic');assert.equal(h.history.length,1);assert.equal(h.ctx.pages[0],h.history[0].after.rows[0]);
 assert.equal(h.history[0].before.rows[0].annots[0].text,'EDITED');assert.match(h.messages.at(-1).message,/반영됐지만 미리보기/);assert.equal(h.messages.at(-1).error,true);
 assert(!h.messages.some(m=>m.message.includes('Basic으로 전환하지 못했습니다')));assert.equal(h.finished,1);assert.equal(h.destroyed,0);
});
test('failure before publication retains Pro pages and settings, without creating an undo entry',async()=>{
 const h=harness({pageFailure:true});assert.equal(await h.run(),false);assert.equal(h.ctx.pages[0],h.originalPage);assert.equal(h.ctx.docs.get('old'),h.originalSource);
 assert.equal(h.ctx.mode,'pro');assert.equal(h.ctx.tools,'edited');assert.equal(h.history.length,0);assert.equal(h.finished,1);assert.equal(h.destroyed,1);
});
