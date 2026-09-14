const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../src/',name),'utf8');
const part=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const ui=read('pro-ui.js'),tools=read('pro-tools-ui.js');
const result=require('../src/pro-result.js');
const makePage=uid=>({uid,docId:'d1',srcIndex:Number(uid.slice(1))-1,rotation:0,annots:[],el:{classList:{toggle(){}}}});
function optionContext(pages){
  const values={proResolution:2400,proQuality:82,proBWThreshold:180,proContrast:0,proWhitePoint:255,proCompressionMode:'preserve',proPaper:'original',proNumberPosition:'bottom-center',proWatermark:''};
  const fields=new Map(),get=id=>{if(!fields.has(id))fields.set(id,{value:String(values[id]??''),checked:id==='proOptimize'||id==='proDeskew'});return fields.get(id);};
  const context=vm.createContext({pages,$:get,PADDLE_MODEL_CACHE_TAG:'test'});
  vm.runInContext(part(ui,'function proFingerprint()','function proInvalidate(')+part(ui,'function readProOptions(','function refreshProControls(')+part(tools,'function ocrKey(','function readToolOptions('),context);
  return {context,get};
}
test('manual angles follow page UIDs through reorder and a manual zero differs from automatic',()=>{
  const pages=[makePage('p1'),makePage('p2'),makePage('p3')],{context,get}=optionContext(pages);
  const initial=context.proFingerprint();pages[1].deskewAngle=0;pages[2].deskewAngle=-60;
  assert.notEqual(context.proFingerprint(),initial);
  let options=context.readProOptions();assert.deepEqual(JSON.parse(JSON.stringify(options.deskewAngles)),{p2:0,p3:-60});
  pages.reverse();options=context.readProOptions();assert.equal(options.deskewAngles.p3,-60);assert.equal(options.deskewAngles.p2,0);assert.equal(options.deskewAngles.p1,undefined);
  get('proDeskew').checked=false;assert.equal(context.readProOptions().deskew,false);assert.equal(context.readProOptions().deskewAngles.p3,-60);
  pages[0].deskewAngle=NaN;assert.equal(context.readProOptions().deskewAngles.p3,undefined);
});
test('OCR cache is invalidated for the changed page without invalidating unaffected pages',()=>{
  const pages=[makePage('p1'),makePage('p2')],{context}=optionContext(pages),before=context.readProOptions();
  const first=context.ocrKey(pages[0],before),second=context.ocrKey(pages[1],before);
  pages[0].deskewAngle=4.5;let after=context.readProOptions();
  assert.notEqual(context.ocrKey(pages[0],after),first);assert.equal(context.ocrKey(pages[1],after),second);
  pages[0].deskewAngle=0;after=context.readProOptions();assert.notEqual(context.ocrKey(pages[0],after),first);
  delete pages[0].deskewAngle;assert.equal(context.ocrKey(pages[0],context.readProOptions()),first);
});
test('size optimization cannot replace a larger manually rotated output with the unrotated source',()=>{
  const options={optimize:true,whitePoint:255,paper:'original',deskew:false,deskewAngles:{p1:60}},before=new Uint8Array(10),candidate=new Uint8Array(20);
  assert.equal(result.compressionOnly(options),false);assert.equal(result.selectOutput(before,candidate,options).bytes,candidate);
  options.deskewAngles.p1=0;assert.equal(result.compressionOnly(options),true);assert.equal(result.selectOutput(before,candidate,options).bytes,before);
});
test('preview and output summaries retain clockwise signs and distinguish manual zero from auto',()=>{
  const context=vm.createContext({});vm.runInContext(part(ui,'function describeProSettings(','async function createProResult('),context);
  const manual={changed:1,pages:[{page:2,mode:'manual',requestedAngle:-12.5,angle:12.5,displayAngle:-12.5}]};
  assert.match(context.describeProSettings({deskew:false,deskewAngles:{p2:-12.5}},{},manual,1),/수동 기울기 -12\.5°/);
  const auto={changed:1,pages:[{page:1,mode:'auto',angle:-3.2,displayAngle:3.2}]};
  assert.match(context.describeProSettings({deskew:true},{},auto,0),/자동 기울기 \+3\.2°/);
  const zero={changed:0,pages:[{page:1,mode:'manual',angle:0,displayAngle:0,reason:'원본 각도 유지'}]};
  assert.match(context.describeProSettings({deskew:false,deskewAngles:{p1:0}},{},zero,0),/수동 0\.0° · 원본 각도 유지/);
  assert.match(context.proSummary({changed:0,skipped:0,deskew:manual},{characters:0}),/2쪽 수동 -12\.5°/);
  assert.doesNotMatch(context.describeProSettings({deskew:false,deskewAngles:{}},{},null,0),/기울기/);
});
function historyContext(){
  const fields=new Map(),get=id=>{if(!fields.has(id))fields.set(id,{disabled:false,title:'',scrollTop:0,scrollLeft:0,addEventListener(){},classList:{contains(){return false;}}});return fields.get(id);};
  const pages=[makePage('p1'),makePage('p2')],noop=()=>{};
  const context=vm.createContext({Date,structuredClone,console,pages,docs:new Map(),origCount:2,previewUid:'p1',selAnno:null,textEditing:null,textOpening:false,textComposing:false,textUpdate:Promise.resolve(),textEditPending:false,annoStyle:{tool:'none'},pvZoom:1,
    $:get,selected:()=>[],document:{addEventListener(){},querySelector(){return null;},body:{classList:{contains(){return false;}}}},
    captureBoardPositions:()=>[],clearPreview:noop,render:noop,showPreview:async page=>{context.previewUid=page.uid;},renderAnnots:noop,renderInfo:noop,syncCounts:noop,animateBoardFrom:noop,busy:noop,toast:noop});
  vm.runInContext(read('edit-history.js'),context);return context;
}
test('document undo restores per-page manual angles, including removing an override and retaining zero',async()=>{
  const context=historyContext(),page=context.pages[0];
  let before=context.captureEditHistory();page.deskewAngle=12.5;context.commitEditHistory(before,'수동 기울기');
  before=context.captureEditHistory();page.deskewAngle=0;context.commitEditHistory(before,'수동 기울기');
  await context.restoreDocumentHistory(false);assert.equal(context.pages[0].deskewAngle,12.5);
  await context.restoreDocumentHistory(false);assert.equal(Object.hasOwn(context.pages[0],'deskewAngle'),false);
  await context.restoreDocumentHistory(true);assert.equal(context.pages[0].deskewAngle,12.5);
  await context.restoreDocumentHistory(true);assert.equal(context.pages[0].deskewAngle,0);
  assert.equal(Object.hasOwn(context.pages[1],'deskewAngle'),false);
});
