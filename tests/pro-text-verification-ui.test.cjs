const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/pro-ui.js'),'utf8'),helper=require('../src/pro-text-verification.js');
const snippet=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const plain=text=>({items:[{str:text}],styles:{}});
const item=(str,x=20,y=40)=>({str,fontName:'f',transform:[10,0,0,10,x,y],width:20,height:10});
const textContent=items=>({items,styles:{f:{ascent:.8,descent:-.2}}});
const cropReport=page=>({page,cropped:true,matrix:[1,0,0,1,0,0],cropBounds:{x:10,y:10,width:80,height:80},rotation:0,userUnit:1});
function harness(beforePages,afterPages,verificationHelper=helper.verify){
  const destroyed=[0,0],reads=[[],[]],cleaned=[[],[]],helperCalls=[],progress=[],busy=[];
  const pdfs=[beforePages,afterPages].map((pages,index)=>({numPages:pages.length,async getPage(number){reads[index].push(number);return {async getTextContent(){return pages[number-1];},cleanup(){cleaned[index].push(number);}};},async destroy(){destroyed[index]++;}}));
  let opened=0;
  const context=vm.createContext({DOMException,DOC_OPTS:{},pdfjsLib:{getDocument:()=>({promise:Promise.resolve(pdfs[opened++])})},
    PDFProTextVerification:{verify(...args){helperCalls.push(args);return verificationHelper(...args);}},
    idle:async()=>{},busy:(...args)=>busy.push(args),progress:value=>progress.push(value)});
  vm.runInContext(snippet('async function verifyProText(','function describeProSettings(')+snippet('function proSummary(','async function createProResult('),context);
  return {verify:(verification={},quiet=true,signal)=>context.verifyProText(new Uint8Array([1]),new Uint8Array([2]),signal,quiet,verification),summary:context.proSummary,destroyed,reads,cleaned,helperCalls,progress,busy,context};
}
test('multi-page verification routes only cropped pages to geometry verification and accumulates retained/excluded counts',async()=>{
  const before=[plain('A B'),textContent([item('KEEP'),item('EDGE',0)]),textContent([item('outside',0,0)])];
  const after=[plain('AB 1'),plain('KEEP 2'),plain('')],reports=[{page:40,cropped:false},cropReport(41),cropReport(42)],options={crop:false,paper:'original'};
  const h=harness(before,after),result=await h.verify({deskew:{pages:reports},options},false);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{characters:6,checked:3,excludedItems:2,excludedCharacters:11,uncheckedPages:1,sourceCharacters:17});
  assert.equal(h.helperCalls.length,2);assert.equal(h.helperCalls[0][0],before[1]);assert.equal(h.helperCalls[0][1],after[1]);assert.equal(h.helperCalls[0][2],reports[1]);assert.equal(h.helperCalls[0][3],options);assert.equal(h.helperCalls[1][2],reports[2]);
  assert.deepEqual(h.destroyed,[1,1]);assert.equal(h.progress.length,3);assert.equal(h.busy.length,3);
});
test('uncropped pages still require the entire original text in order without inserted content between source runs',async()=>{
  const h=harness([textContent([item('AB'),item('CD')])],[plain('AB X CD')],()=>{throw new Error('uncropped helper must not run');});
  await assert.rejects(()=>h.verify({deskew:{pages:[{page:1,cropped:false}]},options:{crop:false}}),/1페이지.*텍스트/);
  assert.equal(h.helperCalls.length,0);assert.deepEqual(h.destroyed,[1,1]);
});
test('missing text inside a cropped page fails the document check and closes both PDFs',async()=>{
  const h=harness([plain('OK'),textContent([item('KEEP'),item('EDGE',0)]),plain('LATER')],[plain('OK'),plain(''),plain('LATER')]);
  await assert.rejects(()=>h.verify({deskew:{pages:[{page:1,cropped:false},cropReport(2),{page:3,cropped:false}]},options:{crop:false}}),/2페이지.*텍스트/);
  assert.equal(h.helperCalls.length,1);assert.deepEqual(h.reads,[[1,2],[1,2]]);assert.deepEqual(h.destroyed,[1,1]);
});
test('a crop-verifier exception is not silently treated as successful preservation',async()=>{
  const failure=new Error('crop helper failed'),h=harness([plain('SOURCE')],[plain('SOURCE')],()=>{throw failure;});
  await assert.rejects(()=>h.verify({deskew:{pages:[cropReport(1)]},options:{}}),error=>error===failure);assert.deepEqual(h.destroyed,[1,1]);
});
test('all-excluded source text is reported as unverified inside the crop rather than a document with no searchable text',async()=>{
  const h=harness([textContent([item('outside',0,0)])],[plain('')]),result=await h.verify({deskew:{pages:[cropReport(1)]},options:{crop:false}});
  assert.equal(result.characters,0);assert.equal(result.sourceCharacters,7);assert.equal(result.uncheckedPages,1);assert.equal(result.excludedItems,1);assert.equal(result.excludedCharacters,7);
  const summary=h.summary({changed:0,skipped:0},result);
  assert.match(summary,/재단 영역 안에서 검증할 텍스트가 없습니다/);assert.doesNotMatch(summary,/원래 검색 가능한 텍스트가 없는/);assert.doesNotMatch(summary,/0자 보존 확인/);
});
test('crop summaries distinguish verified interior text and excluded boundary text',async()=>{
  const h=harness([textContent([item('KEEP'),item('EDGE',0)])],[plain('KEEP')]),result=await h.verify({deskew:{pages:[cropReport(1)]},options:{crop:false}});
  const summary=h.summary({changed:0,skipped:0},result);
  assert.equal(result.excludedCharacters,4);assert.match(summary,/재단[^\n]*4자[^\n]*(?:검증|확인)/);assert.match(summary,/재단 경계[^\n]*1개 항목[^\n]*보존 검증에서 제외/);assert.doesNotMatch(summary,/기존 텍스트 8자 보존 확인/);
});
test('a truly blank source retains the no-searchable-text explanation and quiet checks do not update progress',async()=>{
  const h=harness([plain(' \n ')],[plain('')]),result=await h.verify();
  assert.equal(result.characters,0);assert.equal(result.sourceCharacters,0);assert.equal(result.checked,1);assert.equal(result.excludedItems,0);assert.equal(result.uncheckedPages,0);
  assert.match(h.summary({changed:0,skipped:0},result),/원래 검색 가능한 텍스트가 없는 문서/);assert.equal(h.progress.length,0);assert.equal(h.busy.length,0);assert.deepEqual(h.destroyed,[1,1]);
});
test('cancellation and page-count mismatch are failures with PDF cleanup',async()=>{
  const controller=new AbortController();controller.abort();const cancelled=harness([plain('A')],[plain('A')]);
  await assert.rejects(()=>cancelled.verify({},true,controller.signal),error=>error.name==='AbortError');assert.deepEqual(cancelled.destroyed,[0,0]);assert.deepEqual(cancelled.reads,[[],[]]);
  const mismatch=harness([plain('A')],[plain('A'),plain('B')]);await assert.rejects(()=>mismatch.verify(),/페이지 수가 달라졌습니다/);assert.deepEqual(mismatch.destroyed,[1,1]);
});
test('hundreds of pages are released before verification advances to the next pair',async()=>{
  const list=Array.from({length:400},(_,i)=>plain('PAGE '+i)),h=harness(list,list);let ticks=0;
  h.context.idle=async()=>{ticks++;assert.equal(h.cleaned[0].length,ticks);assert.equal(h.cleaned[1].length,ticks);};
  const result=await h.verify();assert.equal(result.checked,400);assert.equal(ticks,400);assert.deepEqual(h.destroyed,[1,1]);
});
test('comparison failure releases both current pages, without visiting the remaining pages',async()=>{
  const h=harness([plain('FIRST'),plain('KEEP'),plain('LATER')],[plain('FIRST'),plain('MISSING'),plain('LATER')]);
  await assert.rejects(h.verify(),/2페이지/);assert.deepEqual(h.cleaned,[[1,2],[1,2]]);assert.deepEqual(h.reads,[[1,2],[1,2]]);
});
test('a loading failure closes its loading task even before a PDF proxy exists',async()=>{
  const h=harness([],[]);let destroyed=0;
  h.context.pdfjsLib.getDocument=()=>({promise:Promise.reject(new Error('broken PDF')),async destroy(){destroyed++;}});
  await assert.rejects(h.verify(),/broken PDF/);assert.equal(destroyed,1);
});
test('canceling while the PDF is loading terminates that task and reports cancellation',async()=>{
  const h=harness([],[]),controller=new AbortController();let rejectLoad,destroyed=0;
  h.context.pdfjsLib.getDocument=()=>({promise:new Promise((_,reject)=>rejectLoad=reject),async destroy(){destroyed++;rejectLoad(new Error('worker terminated'));}});
  const result=h.verify({},true,controller.signal),rejected=assert.rejects(result,{name:'AbortError'});controller.abort();await rejected;assert.equal(destroyed,1);
});
