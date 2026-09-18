const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/pro-tools-ui.js'),'utf8');
const section=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
const helpers=section('function ocrValidWord(','function configureLocalOCR(')+section('function waitForOCR(','let toolsRevision=')+section('function ocrKey(','function syncToolsState(');
const word=()=>({text:'계약',box:[.1,.1,.2,.2],separator:'\n',confidence:99});
function harness(count,{searchable=false,failPage=0,cancelAtYield=0}={}){
  const nodes=new Map(),stats={pageReads:0,textReads:0,operatorReads:0,recognitions:0,closes:0,cleanup:0,yields:0,publications:0,optionScopes:[],canvases:[],maxCanvas:0};
  const pages=Array.from({length:count},(_,i)=>({uid:'p'+i,docId:'doc',srcIndex:i,rotation:0,annots:[]}));
  const options={paper:'original',whitePoint:255,optimize:false,maxDimension:2400,jpegQuality:.8,blackWhite:false,bwThreshold:128,contrast:0,rasterize:false,deskew:false,crop:false,margins:[0,0,0,0]};
  const context={console,AbortController,AbortSignal,DOMException,setTimeout,clearTimeout,performance,Map,Set,JSON,
    PADDLE_MODEL_CACHE_TAG:'fixture',pages,ocrRecords:[],ocrCheckpoints:new Map(),ocrAccepted:false,ocrRunning:false,proAbort:null,stampMarks:[],
    ocrActionIds:['ocrRun'],currentStamp:()=>null,
    $:id=>{if(!nodes.has(id))nodes.set(id,{value:({ocrLanguage:'kor+eng',ocrLayout:'auto',ocrScope:'all'})[id]||'',classList:{remove(){},toggle(){}},scrollIntoView(){}});return nodes.get(id);},
    PDFPrivacy:{isMasked:()=>false,maskKey:()=>null},
    PDFOCRPolicy:require('../src/ocr-page-policy.js'),
    pdfjsLib:{OPS:{paintImageXObject:1,paintInlineImageXObject:2,paintImageMaskXObject:3,paintImageXObjectRepeat:4,paintInlineImageXObjectGroup:5}},
    proFingerprint:()=>JSON.stringify(pages),toolTargets:()=>pages,
    readProOptions(strict=false,list=pages){stats.optionScopes.push(list.length);return context.readToolOptions({...options},strict,list);},
    startProWork(){context.proAbort=new AbortController();},checkProAbort(){context.proAbort.signal.throwIfAborted();},
    finishProWork(){context.proAbort=null;},progress(){},busy(){},toast(){},toolsChanged(){},
    renderOCRResults(){stats.publications++;},
    async idle(){stats.yields++;if(stats.yields===cancelAtYield)context.proAbort.abort(new DOMException('Stopped','AbortError'));},
    document:{createElement(type){assert.equal(type,'canvas');let width=0,height=0;const c={get width(){return width;},set width(n){width=n;},get height(){return height;},set height(n){height=n;stats.maxCanvas=Math.max(stats.maxCanvas,stats.canvases.filter(c=>c.width&&c.height).length);},getContext:()=>({})};stats.canvases.push(c);return c;}},
    docs:new Map([['doc',{pdfjsDoc:{async getPage(n){stats.pageReads++;return {
      async getTextContent(){stats.textReads++;return {items:searchable?[{str:'기존 검색 텍스트'}]:[]};},
      async getOperatorList(){stats.operatorReads++;return {fnArray:searchable?[]:[1]};},
      getViewport:({scale})=>({width:595*scale,height:842*scale}),
      render:()=>({promise:Promise.resolve(),cancel(){}}),cleanup(){stats.cleanup++;}
    };}}}]]),
    PDFOCR:{async session(){return {async recognize(){stats.recognitions++;if(stats.recognitions===failPage)throw new Error('Synthetic page failure');return {text:'계약',words:[word()]};},async close(){stats.closes++;}};}},
    buildEditedDocument(){throw new Error('Unedited scans must not rebuild the document');}
  };
  vm.createContext(context);vm.runInContext(helpers+section('async function runOCR(','function renderOCRResults('),context);
  return {context,stats,nodes,options,async run(){await context.runOCR(false,'tesseract');}};
}

test('300 OCR pages keep only one live raster and preserve completed page order',async()=>{
  const h=harness(300);await h.run();
  assert.equal(h.context.ocrRecords.length,300);assert.equal(h.context.ocrCheckpoints.size,300);
  assert.deepEqual(Array.from(h.context.ocrRecords,r=>r.page),Array.from({length:300},(_,i)=>i+1));
  assert.equal(h.stats.recognitions,300);assert.equal(h.stats.cleanup,300);assert.equal(h.stats.maxCanvas,1);
  assert.ok(h.stats.canvases.every(c=>c.width===0&&c.height===0));assert.equal(h.stats.closes,1);
  assert.equal(h.context.ocrRunning,false);assert.equal(h.context.proAbort,null);
});

test('rerunning 300 completed pages uses checkpoints without decoding or recognizing again',async()=>{
  const h=harness(300);await h.run();const reads=h.stats.pageReads;await h.run();
  assert.equal(h.stats.pageReads,reads);assert.equal(h.stats.recognitions,300);assert.equal(h.context.ocrRecords.length,300);
  assert.ok(h.nodes.get('ocrStatus').textContent.includes('재사용'));
});

test('cancelled searchable-page batches yield, retain results, and resume without reopening completed pages',async()=>{
  const h=harness(300,{searchable:true,cancelAtYield:60});await h.run();
  assert.equal(h.stats.pageReads,60);assert.equal(h.stats.yields,60);assert.equal(h.stats.cleanup,60);
  assert.equal(h.context.ocrRecords.length,60);assert.ok(h.context.ocrRecords.every(r=>r.skipped));
  assert.equal(h.stats.recognitions,0);assert.equal(h.context.ocrCheckpoints.size,60);
  await h.run();assert.equal(h.stats.pageReads,300);assert.equal(h.context.ocrRecords.length,300);
  assert.equal(h.stats.recognitions,0);assert.equal(h.stats.cleanup,300);
});

test('failure on page 90 exposes the first 89 results and resumes from the failed page',async()=>{
  const h=harness(212,{failPage:90});await h.run();
  assert.equal(h.context.ocrRecords.length,89);assert.equal(h.context.ocrCheckpoints.size,89);
  assert.ok(h.nodes.get('ocrStatus').textContent.includes('90쪽'));assert.equal(h.stats.cleanup,90);
  await h.run();assert.equal(h.context.ocrRecords.length,212);assert.equal(h.stats.recognitions,213);assert.equal(h.stats.cleanup,213);
});

test('checkpoint validation never copies the already accepted document-wide OCR text layer',async()=>{
  const h=harness(120);
  h.context.ocrRecords=h.context.pages.map((p,i)=>({uid:p.uid,key:h.context.ocrKey(p,h.options),page:i+1,source:'tesseract',language:'eng',layout:'auto',text:'original',words:Array.from({length:2000},word)}));
  h.context.ocrAccepted=true;await h.run();
  assert.equal(h.stats.recognitions,120);assert.equal(h.context.ocrRecords.length,120);
  assert.ok(h.stats.optionScopes.length>=120);assert.ok(h.stats.optionScopes.every(n=>n===0),'Recognition-only option reads requested the accepted text layer');
});

test('OCR export validates only selected pages and never includes stale or unaccepted text',()=>{
  const h=harness(3),{context:c,options}=h;
  c.ocrRecords=c.pages.map((p,i)=>({uid:p.uid,key:c.ocrKey(p,options),page:i+1,source:'tesseract',text:'계약',words:[word()]}));
  c.ocrRecords[0].key='stale';c.ocrAccepted=false;
  assert.equal(c.readToolOptions({...options},true).ocr.length,0);
  c.ocrAccepted=true;assert.throws(()=>c.readToolOptions({...options},true),/OCR 후/);
  assert.deepEqual(Array.from(c.readToolOptions({...options},true,[c.pages[2]]).ocr,r=>r.uid),['p2']);
  assert.deepEqual(Array.from(c.readToolOptions({...options},false).ocr,r=>r.uid),['p1','p2']);
});

function loadActiveUI(c){
  Object.assign(c,{previewUid:null,selected:()=>[],toolsRevision:0,toolsLastState:'',ocrPageOrder:'',stampAsset:null,renderStampMarks(){},syncToolSummaries(){},renderOCRText(){}});
  vm.runInContext(section('function activeOCREntries(','function toolsChanged(')+section('function syncToolsState(','function resetTools('),c);
}
test('deleting and reordering pages keeps remaining OCR usable and retains removed records for undo',()=>{
  const h=harness(3),{context:c,options}=h;loadActiveUI(c);
  c.ocrRecords=c.pages.map((p,i)=>({uid:p.uid,key:c.ocrKey(p,options),page:i+1,source:'tesseract',text:'계약 '+i,words:[word()]}));
  const removedPage=c.pages[1],removedRecord=c.ocrRecords[1];c.pages.splice(1,1);c.pages.reverse();c.syncToolsState();
  assert.equal(h.nodes.get('ocrCorrect').disabled,false);assert.equal(h.nodes.get('ocrAccept').disabled,false);
  assert.deepEqual(Array.from(c.activeOCREntries(),e=>[e.record.uid,e.index,e.page]),[['p2',2,1],['p0',0,2]]);
  assert.equal(c.ocrRecords[1],removedRecord,'Undo-only records must remain intact');
  c.pages.splice(1,0,removedPage);c.syncToolsState();
  assert.deepEqual(Array.from(c.activeOCREntries(),e=>e.record.uid),['p2','p1','p0']);
  c.pages.length=0;c.syncToolsState();assert.equal(h.nodes.get('ocrCorrect').disabled,true);assert.equal(h.nodes.get('ocrAccept').disabled,true);
});

test('correcting active pages does not lose OCR data belonging to a deleted page that can be undone',async()=>{
  const h=harness(3),{context:c,options}=h;loadActiveUI(c);
  c.ocrRecords=c.pages.map((p,i)=>({uid:p.uid,key:c.ocrKey(p,options),page:i+1,source:'tesseract',text:'계약 '+i,words:[word()]}));
  const retained=c.ocrRecords[1];c.pages.splice(1,1);c.pages.reverse();c.syncToolsState();c.$('ocrResultPage').value='2';
  c.renderOCRCorrectionPage=()=>{};c.PDFOCRTableAnalysis={createCellReader:()=>({recognizeRegion(){},async close(){}})};
  c.PDFOCRCorrection={async open(config){
    assert.deepEqual(Array.from(config.records,r=>[r.uid,r.page]),[['p2',1],['p0',2]]);assert.equal(config.initialIndex,0);
    const edits=structuredClone(config.records);edits[0].words[0].text='교정';edits[0].text='교정';config.onApply(edits);
  }};
  vm.runInContext(section("$('ocrCorrect').onclick=", "$('ocrProvider').onchange="),c);
  await c.$('ocrCorrect').onclick();
  assert.equal(c.ocrRecords[1],retained);assert.equal(c.ocrRecords[2].words[0].text,'교정');assert.equal(c.ocrRecords[2].page,1);
  assert.equal(c.ocrAccepted,false);assert.equal(c.ocrCheckpoints.get('tesseract:p2').text,'교정');
});
