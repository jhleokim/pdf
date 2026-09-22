'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),editor=fs.readFileSync(path.join(root,'src/editor.js'),'utf8');
const rotateCode=editor.slice(editor.indexOf('function rotate(list, deg){'),editor.indexOf('function commitMove('));
const plain=value=>JSON.parse(JSON.stringify(value));
function editorClient(pages,{busy=false}={}){
 const transactions=[];
 const context=vm.createContext({pages,previewUid:null,document:{body:{classList:{contains:()=>busy}}},
   render(){},syncCounts(){},captureEditHistory:()=>plain(pages),
   commitEditHistory:(before,label)=>transactions.push({before,after:plain(pages),label})});
 for(const page of pages)page.el={classList:{add(){}}};
 vm.runInContext(rotateCode,context);return {rotate:context.rotate,transactions};
}
const page=(uid,annots=[])=>({uid,rotation:0,annots});
const mask=(id,box,extra={})=>({id,shape:'redaction',nx:box[0],ny:box[1],nw:box[2],nh:box[3],...extra});
const rect=a=>[a.nx,a.ny,a.nw,a.nh];

test('rotation carries manual and automatic masks through one undoable edit without touching other pages',()=>{
 const manual=mask('manual',[.1,.2,.3,.15]),automatic=mask('automatic',[.6,.6,.2,.1],{detectionId:'candidate-1'}),text={shape:'text',nx:.3,ny:.4,text:'Public note'};
 const selected=page('selected',[manual,automatic,text]),other=page('other',[mask('other',[.2,.3,.2,.3])]),h=editorClient([selected,other]);
 const original=plain(selected.annots),untouched=plain(other);
 h.rotate([selected],90);
 assert.equal(selected.rotation,90);assert.equal(h.transactions.length,1);assert.equal(h.transactions[0].label,'페이지 회전');
 assert.deepEqual(h.transactions[0].before[0].annots,original);assert.deepEqual(h.transactions[0].after[0].annots,plain(selected.annots));
 assert.deepEqual(plain(other),untouched);assert.deepEqual(text,original[2]);assert.equal(automatic.detectionId,'candidate-1');
 assert.equal(manual,selected.annots[0]);assert.equal(automatic,selected.annots[1]);
 h.rotate([selected],-90);
 for(let i=0;i<2;i++)for(let n=0;n<4;n++)assert.ok(Math.abs(rect(selected.annots[i])[n]-rect(original[i])[n])<1e-12);
 assert.equal(selected.rotation,0);
});

test('busy and invalid rotation never move masks or create a history entry',()=>{
 const target=page('selected',[mask('manual',[.1,.2,.3,.15])]),h=editorClient([target]),before=plain(target);
 for(const invalid of [NaN,Infinity,45])h.rotate([target],invalid);
 assert.deepEqual(plain(target),before);assert.equal(h.transactions.length,0);
 const blocked=editorClient([target],{busy:true});blocked.rotate([target],90);
 assert.deepEqual(plain(target),before);assert.equal(blocked.transactions.length,0);
});

test('page-edge masks stay within normalized bounds after floating-point rotation',()=>{
 for(const delta of [90,180,270]){
  const target=page('edge',[mask('auto',[.8,.8,.2,.2])]),h=editorClient([target]);
  h.rotate([target],delta);
  const a=target.annots[0];
  assert.ok(a.nx>=0&&a.ny>=0);assert.ok(a.nx+a.nw<=1&&a.ny+a.nh<=1);
 }
});

const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),library=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('.PDFLib='));
const mod={exports:{}};vm.runInNewContext(library,{module:mod,exports:mod.exports,Array,Uint8Array,ArrayBuffer,Int32Array,Uint32Array,Uint16Array,Int16Array,Int8Array,Float32Array,Float64Array,setTimeout,clearTimeout});
const P=mod.exports,runtime=Promise.all([import('../src/privacy-native-worker.js'),import('mupdf')]);
async function maskAtText(M,bytes,needle){
 const doc=M.Document.openDocument(bytes,'application/pdf'),p=doc.loadPage(0);
 try{
  const [quad]=p.search(needle)[0],bounds=p.getBounds(),xs=quad.filter((_,i)=>i%2===0),ys=quad.filter((_,i)=>i%2===1),width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];
  return [(Math.min(...xs)-bounds[0]-1)/width,(Math.min(...ys)-bounds[1]-1)/height,(Math.max(...xs)-Math.min(...xs)+2)/width,(Math.max(...ys)-Math.min(...ys)+2)/height];
 }finally{p.destroy();doc.destroy();}
}

test('saved masks keep removing the same text for every source orientation and left/right/half-turn',async()=>{
 const [native,M]=await runtime;
 for(const originalAngle of [0,90,180,270])for(const delta of [-90,90,180,270]){
  const doc=await P.PDFDocument.create(),p=doc.addPage([430,670]);
  p.setCropBox(17,23,390,620);p.node.set(P.PDFName.of('UserUnit'),P.PDFNumber.of(1.5));p.setRotation(P.degrees(originalAngle));
  p.drawText('PRIVATE123456',{x:61,y:530,size:17});p.drawText('PUBLIC CONTENT',{x:62,y:90,size:17});
  const state=page('selected',[mask('auto',await maskAtText(M,await doc.save(),'PRIVATE123456'),{detectionId:'candidate'})]),h=editorClient([state]);
  h.rotate([state],delta);p.setRotation(P.degrees((originalAngle+state.rotation)%360));
  const result=await native.process({bytes:await doc.save(),masks:[[rect(state.annots[0])]]}),output=M.Document.openDocument(result.bytes,'application/pdf'),outPage=output.loadPage(0),structured=outPage.toStructuredText();
  try{
   const text=structured.asText(),label=`source ${originalAngle}°, edit ${delta}°`;
   assert.ok(!text.includes('PRIVATE'),label+' leaked masked text');assert.ok(text.includes('PUBLIC CONTENT'),label+' removed unmasked text');
  }finally{structured.destroy();outPage.destroy();output.destroy();}
 }
});
