const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
const review=require('../src/pro-review-stamp.js');
function harness(){
  const fields=new Map(),noop=()=>{},renders=[],classes=()=>{const values=new Set();return {contains:x=>values.has(x),add:x=>values.add(x),remove:x=>values.delete(x),toggle(x,on){if(on)values.add(x);else values.delete(x);}};};
  function node(){const attrs=new Map();return {children:[],style:{},dataset:{},classList:classes(),value:'',hidden:false,scrollTop:0,scrollLeft:0,
    setAttribute(k,v){attrs.set(k,String(v));},getAttribute:k=>attrs.get(k),removeAttribute:k=>attrs.delete(k),hasAttribute:k=>attrs.has(k),
    append(...children){this.children.push(...children);},querySelectorAll(){return [];},closest(){return this;},addEventListener:noop,click(){this.onclick?.();},hasPointerCapture:()=>false};}
  const $=id=>{if(!fields.has(id))fields.set(id,node());return fields.get(id);};
  Object.assign($('stampScope'),{value:'current'});Object.assign($('stampAnchor'),{value:'top-left'});
  for(const [id,value]of Object.entries({stampX:'20',stampY:'20',stampWidth:'50',stampOpacity:'100',stampName:'원래 문구'}))$(id).value=value;
  $('stampSave').onclick=$('stampPng').onclick=noop;
  const page={uid:'p1',docId:'d1',rotation:0,annots:[],el:node()};
  const context=vm.createContext({console,Date,structuredClone,document:{createElement:node,createElementNS:node,addEventListener:noop,querySelector:()=>null,activeElement:null,body:{dataset:{mode:'pro'},classList:classes()}},ResizeObserver:class{observe(){}},
    $,pages:[page],docs:new Map([['d1',{}]]),origCount:1,selected:()=>[],previewUid:'p1',selAnno:null,stampAsset:null,stampMarks:[],stampEditing:null,stampShelf:[],stampPositioning:false,
    proMode:'pro',proPreviewOpen:false,proAbort:null,liveCache:null,liveOutputSize:{width:600,height:800},
    stampControlIds:['stampScope','stampAnchor','stampX','stampY','stampWidth','stampOpacity'],PDFStamp:require('../src/pro-stamp.js'),
    PDFReviewStamp:{...review,presets:[],render(value){return new Promise((resolve,reject)=>renders.push({value,resolve:()=>resolve({data:'data:image/png;base64,'+value.text,ratio:3,name:value.text,review:value}),reject}));}},
    toolsChanged:noop,setStampPositioning:noop,renderStampMarks:noop,toast:noop,livePage:()=>context.pages.find(p=>p.uid===context.previewUid),
    toolTargets:()=>context.pages,proNumberInput:id=>Number($(id).value),renderStampShelf:noop,scheduleLivePreview:noop,cancelLivePreview:noop,
    render:noop,renderAnnots:noop,renderInfo:noop,syncCounts:noop,animateBoardFrom:noop,busy:noop,captureBoardPositions:()=>[],
    textUpdate:Promise.resolve(),textEditPending:false,textEditing:null,textOpening:false,textComposing:false,annoStyle:{tool:'none'},pvZoom:1,
    pvToken:0,pvRenderTask:null,setPvTitle:noop,syncLivePreview:noop,clearPreview(){context.previewUid=null;},
  });
  const tools=read('pro-tools-ui.js');
  vm.runInContext(tools.slice(tools.indexOf('function toolTargets('),tools.indexOf('function ocrKey(')),context);
  vm.runInContext(tools.split('\n').find(line=>line.startsWith("$('stampCommit').onclick=")),context);
  vm.runInContext(tools.split('\n').find(line=>line.startsWith('for(const id of stampControlIds)')),context);
  context.$('stampClear').onclick=()=>{context.stampAsset=null;};
  vm.runInContext(read('edit-history.js'),context);
  vm.runInContext(read('pro-review-stamp-ui.js'),context);
  const editor=read('editor.js');vm.runInContext(editor.slice(editor.indexOf('async function showPreview(p)'),editor.indexOf('function setZoom(')),context);
  context.stampAsset={data:'data:image/png;base64,old',ratio:3,name:'원래 문구',review:review.normalize({text:'원래 문구'}),targets:['p1']};
  return {context,$,renders};
}

test('undo of a committed review stamp restores its editable draft without navigation committing it again',async()=>{
  const {context:c}=harness(),before=c.captureStampHistory().signature;
  c.$('stampCommit').click();assert.equal(c.stampAsset,null);assert.equal(c.stampMarks.length,1);
  await c.restoreDocumentHistory(false);
  assert.ok(c.stampAsset,'undo must restore the active placement');assert.equal(c.stampMarks.length,0);assert.equal(c.captureStampHistory().signature,before);
  await c.restoreDocumentHistory(true);assert.equal(c.stampAsset,null);assert.equal(c.stampMarks.length,1);
});

test('overlapping review text and color renders preserve both edits and ignore stale completion',async()=>{
  const {context:c,$,renders}=harness();
  $('reviewStampText').value='새로운 문구';const typing=$('reviewStampText').oninput();
  $('reviewStampColor').value='#0077bb';const coloring=$('reviewStampColor').oninput();
  assert.equal(renders.length,2);renders[1].resolve();await coloring;renders[0].resolve();await typing;
  assert.equal(c.stampAsset.review.text,'새로운 문구');assert.equal(c.stampAsset.review.color,'#0077bb');assert.equal(c.reviewStampPending(),false);
});

test('scope changes during review rendering retain the pending text and captured target identities',async()=>{
  const {context:c,$,renders}=harness(),second={uid:'p2',docId:'d1',rotation:0,annots:[]};c.pages.push(second);c.selected=()=>[second];
  $('reviewStampText').value='범위 변경 중 입력';const typing=$('reviewStampText').oninput();
  $('stampScope').value='selected';$('stampScope').oninput();
  c.pages.reverse();c.selected=()=>[c.pages[1]];
  renders[0].resolve();await typing;
  const mark=c.currentStamp();assert.equal(mark.review.text,'범위 변경 중 입력');assert.equal(mark.scope,'selected');assert.deepEqual(Array.from(mark.targets),['p2']);
  assert.equal(c.reviewStampPending(),false);
});

test('newer review changes merge after a scope change and failed rendering never revives older text',async()=>{
  const {context:c,$,renders}=harness();
  $('reviewStampText').value='대기 중 문구';const typing=$('reviewStampText').oninput();
  $('stampScope').value='all';$('stampScope').oninput();
  $('reviewStampColor').value='#0077bb';const coloring=$('reviewStampColor').oninput();
  assert.equal(renders[1].value.text,'대기 중 문구');assert.equal(renders[1].value.color,'#0077bb');
  renders[1].reject(new Error('render failed'));await coloring;
  renders[0].resolve();await typing;
  const mark=c.currentStamp();assert.equal(mark.review.text,'원래 문구');assert.equal(mark.scope,'all');assert.deepEqual(Array.from(mark.targets),['p1']);assert.equal(c.reviewStampPending(),false);
});

test('scope changes cannot redirect pending rendering into a different active stamp',async()=>{
  const {context:c,$,renders}=harness();
  $('reviewStampText').value='이전 도장 문구';const typing=$('reviewStampText').oninput();
  c.stampAsset={...c.stampAsset,review:review.normalize({text:'다른 도장'})};
  $('stampScope').value='all';$('stampScope').oninput();
  renders[0].resolve();await typing;
  assert.equal(c.stampAsset.review.text,'다른 도장');assert.equal(c.currentStamp().scope,'all');assert.equal(c.reviewStampPending(),false);
});
