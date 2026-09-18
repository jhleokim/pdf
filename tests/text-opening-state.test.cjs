const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/markup-editor.js'),'utf8');
function harness(){
  let release,start;const ready=new Promise(resolve=>release=resolve),started=new Promise(resolve=>start=resolve),fields=new Map(),noop=()=>{};
  const $=id=>{if(!fields.has(id))fields.set(id,{style:{},value:'',textContent:'',addEventListener:noop,focus:noop});return fields.get(id);};
  const page={uid:'p1',docId:'d1',srcIndex:0,rotation:0,annots:[]};
  const context=vm.createContext({structuredClone,document:{body:{classList:{contains:()=>false}}},window:{addEventListener:noop},$,pages:[page],previewUid:'p1',proMode:'basic',annoStyle:{tool:'text'},selAnno:null,annoUidSeq:0,
    docs:new Map([['d1',{pdfjsDoc:{getPage:async()=>({rotate:0,getViewport:({rotation})=>rotation%180?{width:800,height:600}:{width:600,height:800}})}}]]),
    PDFMarkupText:{load(){start();return ready;},families:{gothic:{family:'Test'}}},isMobile:()=>false,renderAnnots:noop,syncCounts:noop,toast:noop,
    curAnnots:()=>context.pages.find(p=>p.uid===context.previewUid)?.annots||[],setTool:tool=>context.annoStyle.tool=tool});
  vm.runInContext(source.slice(0,source.indexOf('/* A draggable page action')),context);
  context.relayoutText=async a=>Object.assign(a,{textLayout:{width:20,height:14},nw:20/a.pageWidth,nh:14/a.pageHeight});
  return {context,page,release,started};
}
test('font loading cannot open a Basic text editor after the user switches to Pro',async()=>{
  const {context:c,page,release,started}=harness(),opening=c.openTextEditor({x:.2,y:.3});
  await started;c.proMode='pro';release();await opening;
  assert.equal(vm.runInContext('textEditing',c),null);assert.equal(page.annots.length,0);
});
test('rotation during font loading cancels the stale text dimensions and allows the next edit',async()=>{
  const {context:c,page,release,started}=harness(),opening=c.openTextEditor({x:.2,y:.3});
  await started;page.rotation=90;release();await opening;
  assert.equal(vm.runInContext('textEditing',c),null);assert.equal(page.annots.length,0);
  await c.openTextEditor({x:.2,y:.3});const session=vm.runInContext('textEditing',c);
  assert.equal(session.a.pageWidth,800);assert.equal(session.a.pageHeight,600);assert.equal(page.annots.length,1);
});
test('changing annotation tools during font loading does not reopen the old text tool',async()=>{
  const {context:c,page,release,started}=harness(),opening=c.openTextEditor({x:.2,y:.3});
  await started;c.annoStyle.tool='highlight';release();await opening;
  assert.equal(vm.runInContext('textEditing',c),null);assert.equal(page.annots.length,0);assert.equal(c.annoStyle.tool,'highlight');
});
