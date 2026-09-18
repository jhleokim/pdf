const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/editor.js'),'utf8');
const code=source.slice(source.indexOf('async function insertBlankPage('),source.indexOf('function remove(list)'));
test('failed blank-page preview retains the insertion and its complete undo snapshot',async()=>{
 const originalPage={uid:'p1',docId:'old',srcIndex:0,rotation:0,annots:[{shape:'text',text:'KEEP'}]},sourceDoc={pdfjsDoc:{async getPage(){return {view:[0,0,400,600],userUnit:1,rotate:0};}}};
 const history=[],events=[],messages=[];let working=false,destroyed=0;
 const blankPdf={async destroy(){destroyed++;}},canvas={width:200,height:300};
 const snapshot=()=>({pages:ctx.pages.slice(),sources:new Map(ctx.docs)});
 const ctx=vm.createContext({console:{error(){}},document:{body:{classList:{contains:()=>working}}},pages:[originalPage],docs:new Map([['old',sourceDoc]]),docSeq:0,uidSeq:1,lastClicked:null,DOC_OPTS:{},SWATCH:['teal'],
  selected:()=>[originalPage],captureEditHistory:snapshot,busy:on=>working=on,
  PDFDocument:{async create(){return {addPage(size){assert.deepEqual(Array.from(size),[400,600]);},async save(){return new Uint8Array([1,2,3]);}};}},
  pdfjsLib:{getDocument:()=>({promise:Promise.resolve(blankPdf)})},renderThumb:async()=>canvas,
  render:()=>ctx.pages.forEach(p=>p.el={classList:{add(){}},scrollIntoView(){events.push('scroll');}}),syncCounts(){},
  commitEditHistory(before,label){history.push({before,after:snapshot(),label});events.push('commit');},
  showPreview:async()=>{events.push('preview');assert.equal(history.length,1);throw new Error('canvas allocation failed');},toast:(message,error)=>messages.push({message,error})});
 vm.runInContext(code,ctx);await ctx.insertBlankPage();
 assert.equal(ctx.pages.length,2);assert.equal(ctx.pages[0],originalPage);const added=ctx.pages[1];assert.equal(added.uid,'p2');assert.equal(ctx.docs.get(added.docId).pdfjsDoc,blankPdf);
 assert.equal(history.length,1);assert.equal(history[0].label,'빈 페이지 추가');assert.equal(history[0].before.pages.length,1);assert.equal(history[0].before.pages[0],originalPage);assert.equal(history[0].before.sources.get('old'),sourceDoc);assert.equal(history[0].before.pages[0].annots[0].text,'KEEP');
 assert.equal(history[0].after.pages[1],added);assert.deepEqual(events,['commit','preview']);assert.equal(working,false);assert.equal(destroyed,0,'the published PDF must remain usable after preview failure');
 assert.match(messages.at(-1).message,/빈 페이지는 추가됐습니다/);assert(!messages.some(m=>m.message.includes('추가하지 못했습니다')));
});
