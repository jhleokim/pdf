'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto').webcrypto;
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/privacy-auto-ui.js'),'utf8');
const detect=require('../src/privacy-detect.js'),model=require('../src/privacy-auto-model.js'),privacy=require('../src/privacy-export.js');
function harness({count=1,renderFail=false,captureFailure=0,historyFailure=false,sanitizeFailure=0,onSupported,measureText}={}){
 const counters={render:0,capture:0,sanitize:0,supported:0,scrollIntoView:0,overlayClears:0},nodes=new Map(),stored=new Map(),messages=[];
 class Node{
  constructor(tag='div'){this.tagName=tag.toLowerCase();this.children=[];this.dataset={};this.style={};this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.open=false;this.listeners=new Map();this.attributes=new Map();this.scrollTop=0;this.width=0;this.height=0;}
  append(...children){for(const c of children){c.parent=this;this.children.push(c);}}
  replaceChildren(...children){if(this===nodes.get('privacyAutoOverlay'))counters.overlayClears++;this.children=[];this.append(...children);}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
  getAttribute(name){return this.attributes.get(name);}
  matches(selector){
   if(selector.includes(','))return selector.split(',').some(s=>this.matches(s));
   const tag=selector.match(/^[a-z]+/)?.[0];if(tag&&tag!==this.tagName)return false;
   if(selector.includes(':checked')&&!this.checked)return false;
   for(const m of selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)){const value=m[1].startsWith('data-')?this.dataset[m[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:this[m[1]];if(value===undefined||m[2]!==undefined&&String(value)!==m[2])return false;}
   return true;
  }
  querySelectorAll(selector){const result=[];for(const child of this.children){if(child.matches(selector))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let n=this;n;n=n.parent)if(n.matches(selector))return n;return null;}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  showModal(){this.open=true;}
  close(){this.open=false;this.listeners.get('close')?.();}
  focus(){this.focused=true;}
  scrollIntoView(){counters.scrollIntoView++;}
  getBoundingClientRect(){return {top:0,bottom:1000,left:0,right:1000,width:1000,height:1000};}
  getContext(){const context={drawImage(){},fontKerning:'auto'};if(measureText)context.measureText=text=>measureText(text,context.fontKerning);return context;}
  setPointerCapture(id){this.pointer=id;}
  hasPointerCapture(id){return this.pointer===id;}
  releasePointerCapture(){this.pointer=null;}
 }
 const node=id=>{if(!nodes.has(id))nodes.set(id,new Node(id.endsWith('Canvas')?'canvas':'div'));return nodes.get(id);};
 node('privacyAutoReview').hidden=true;node('privacyAutoScope').value='all';node('privacyAutoStyle').value='full';
 const pages=Array.from({length:count},(_,i)=>({uid:'p'+i,docId:'doc',srcIndex:i,rotation:0,annots:[]})),options={paper:'original',crop:false,deskew:false,deskewAngles:{},deskewCropByPage:{}};
 const key=(p,o)=>JSON.stringify([p.uid,p.rotation,p.annots,o.paper,o.crop,o.deskew,o.deskewAngles[p.uid]]);
 const records=pages.map((p,i)=>({uid:p.uid,key:key(p,options),page:i+1,source:'vision',coverage:'full',words:[{text:'900101-1234567',box:[.1,.2,.5,.25],separator:'\n'},{text:'PUBLIC',box:[.1,.6,.5,.65],separator:'\n'}],text:'900101-1234567\nPUBLIC',nativeTextBoxes:[],nativeTextUnmapped:false}));
 const context=vm.createContext({console,setTimeout,clearTimeout,TextEncoder,Uint8Array,AbortController,DOMException,crypto,JSON,Map,Set,structuredClone,
  document:{createElement:tag=>new Node(tag),createElementNS:(_,tag)=>new Node(tag)},Option:function(text,value){const n=new Node('option');n.textContent=text;n.value=value;return n;},CSS:{escape:value=>value},
  localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},$:node,pages,docs:new Map(),ocrRecords:records,ocrCheckpoints:new Map(records.map(r=>['vision:'+r.uid,r])),ocrRunning:false,proAbort:null,annoUidSeq:20,
  toolTargets:()=>context.pages,readProOptions:()=>options,ocrKey:key,ocrRecordCurrent:(r,p,o)=>r.key===key(p,o),
  ocrValidWord:w=>!!w.text.trim()&&Array.isArray(w.box)&&w.box.length===4&&w.box.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&w.box[2]>w.box[0]&&w.box[3]>w.box[1],
  PDFPrivacyDetect:detect,PDFPrivacyAutoModel:{...model,sanitizeRecord(...args){if(++counters.sanitize===sanitizeFailure)throw Error('sanitize allocation failed');return model.sanitizeRecord(...args);}},
  PDFPrivacy:{maskKey:privacy.maskKey,async assertSupportedSources(){counters.supported++;await onSupported?.(context,counters);}},
  async renderOCRCorrectionPage(){counters.render++;if(renderFail)throw Error('fixture rendering failed');return Object.assign(new Node('canvas'),{width:600,height:800});},
  captureEditHistory(){if(++counters.capture===captureFailure)throw Error('history allocation failed');return {rows:context.pages.map(p=>({page:p,annots:structuredClone(p.annots)})),signature:JSON.stringify(context.pages.map(p=>[p.uid,p.annots])),sources:[]};},
  collectHistoryDocuments(){},syncHistoryControls(){},renderOCRResults(){},renderAnnots(){},toolsChanged(){},syncCounts(){},syncPrivacy(){},toast:m=>messages.push(m)});
 const historySource=fs.readFileSync(path.join(root,'src/edit-history.js'),'utf8');vm.runInContext(historySource.slice(historySource.indexOf('class EditHistoryStack'),historySource.indexOf('const editHistory='))+';this.editHistory=new EditHistoryStack();',context);
 const push=context.editHistory.push.bind(context.editHistory);context.editHistory.push=(...args)=>{const result=push(...args);if(historyFailure)throw Error('history push failed');return result;};
 vm.runInContext(fs.readFileSync(path.join(root,'src/pro-ocr.js'),'utf8'),context);vm.runInContext(source,context);
 return {context,pages,records,options,node,counters,stored,messages,open(){node('privacyAutoOpen').onclick();},async find(){await node('privacyAutoFind').onclick();},confirm(){node('privacyAutoPageConfirm').checked=true;node('privacyAutoPageConfirm').onchange();},async apply(){await node('privacyAutoApply').onclick();}};
}

test('automatic masking requires current full OCR with usable text coordinates',()=>{
 for(const mutate of [h=>{h.context.ocrRecords=[];},h=>{h.records[0].skipped=true;},h=>{h.records[0].coverage='gaps';},h=>{delete h.records[0].coverage;},h=>{h.records[0].key='stale';},h=>{h.records[0].words=[];},h=>{h.records[0].words[0].box=[0,NaN,1,1];}]){
  const h=harness();mutate(h);h.open();assert.equal(h.node('privacyAutoFind').disabled,true);assert.match(h.node('privacyAutoSetupStatus').textContent,/전체 OCR/);
 }
 const h=harness();h.open();assert.equal(h.node('privacyAutoFind').disabled,false);
});

test('malformed OCR word values return to the OCR gate instead of crashing the setup dialog',()=>{
 for(const value of [123,{},false,null,undefined]){
  const h=harness();h.records[0].words[0].text=value;
  assert.doesNotThrow(()=>h.open());assert.equal(h.node('privacyAutoFind').disabled,true);assert.match(h.node('privacyAutoSetupStatus').textContent,/전체 OCR/);
 }
});

test('a successfully recognized blank page does not block detection of the other pages',async()=>{
 const h=harness({count:2}),blank=h.records[0];blank.words=[];blank.text=' \n';
 h.open();assert.equal(h.node('privacyAutoFind').disabled,false);await h.find();
 assert.equal(h.node('privacyAutoPage').children.length,1);assert.match(h.node('privacyAutoPage').children[0].textContent,/2쪽/);
 h.confirm();await h.apply();assert.equal(h.pages[0].annots.length,0);assert.equal(h.context.ocrRecords[0],blank);assert.equal(h.pages[1].annots.length,1);
 const only=harness();only.records[0].words=[];only.records[0].text='';only.open();await only.find();assert.match(only.node('privacyAutoSetupStatus').textContent,/후보가 없습니다/);
 for(const change of [r=>r.coverage='gaps',r=>r.coverage='none',r=>r.skipped=true,r=>r.key='stale']){
  const invalid=harness();invalid.records[0].words=[];invalid.records[0].text='';change(invalid.records[0]);invalid.open();assert.equal(invalid.node('privacyAutoFind').disabled,true);
 }
});

test('geometry settings block detection and the OCR action only moves focus without starting a cloud call',()=>{
 for(const set of [o=>o.deskew=true,o=>o.crop=true,o=>o.paper='a4',o=>o.deskewAngles.p0=3,o=>o.deskewCropByPage.p0=true]){const h=harness();set(h.options);h.open();assert.equal(h.node('privacyAutoFind').disabled,true);assert.match(h.node('privacyAutoSetupStatus').textContent,/기울기/);}
 const h=harness();h.context.ocrRecords=[];h.open();h.node('privacyAutoOCR').onclick();assert.equal(h.node('privacyAutoDialog').open,false);assert.equal(h.node('ocrWholePage').checked,true);assert.equal(h.node('ocrScope').value,'all');assert.equal(h.node('ocrRun').focused,true);assert.equal(h.counters.render,0);
});

test('render failure keeps apply and page confirmation disabled without modifying the document',async()=>{
 const h=harness({renderFail:true});h.open();await h.find();h.confirm();await h.apply();
 assert.equal(h.node('privacyAutoApply').disabled,true);assert.equal(h.node('privacyAutoPageConfirm').disabled,true);assert.match(h.node('privacyAutoReviewStatus').textContent,/fixture rendering failed/);assert.equal(h.pages[0].annots.length,0);assert.equal(h.context.editHistory.undo.length,0);
});

test('all selected pages need explicit confirmation and edits invalidate their prior confirmation',async()=>{
 const h=harness({count:2});h.open();await h.find();assert.equal(h.node('privacyAutoApply').disabled,true);h.confirm();assert.equal(h.node('privacyAutoApply').disabled,true);
 await h.node('privacyAutoNext').onclick();h.confirm();assert.equal(h.node('privacyAutoApply').disabled,false);
 const check=h.node('privacyAutoCandidates').querySelector('input');check.checked=false;check.onchange();check.checked=true;check.onchange();assert.equal(h.node('privacyAutoApply').disabled,true);h.confirm();assert.equal(h.node('privacyAutoApply').disabled,false);
});

test('partial-region detection uses local font metrics and review starts at the page selector',async()=>{
 const measured=[],kernings=[],h=harness({measureText:(text,kerning)=>{measured.push(text);kernings.push(kerning);return {width:text.length*8};}});
 h.open();h.node('privacyAutoStyle').value='partial';h.node('privacyAutoStyle').onchange();await h.find();
 assert.ok(measured.length>0);assert.equal(new Set(measured).size,measured.length,'font measurements should be cached within one detection run');
 assert.ok(kernings.every(value=>value==='none'),'PDF glyph placement must not inherit contextual browser kerning');
 assert.equal(h.node('privacyAutoPage').focused,true);
 const body=h.node('privacyAutoCandidates').querySelector('button'),meta=body.children.find(n=>n.className==='privacy-auto-meta');
 assert.equal(meta.textContent,'위치 추정 · 경계 확인');
});

test('484-page application sizes OCR undo data page by page without one document-sized serialization',async()=>{
 const h=harness({count:484}),safeJSON=Object.create(JSON);let oversizedWrites=0;
 safeJSON.stringify=(value,...args)=>{
  if(Array.isArray(value)&&value.length>1&&value.every(item=>item&&typeof item.uid==='string'&&item.record)){
   oversizedWrites++;throw Error('document-sized OCR serialization forbidden');
  }
  return JSON.stringify(value,...args);
 };
 h.context.JSON=safeJSON;h.open();await h.find();h.confirm();
 for(let i=1;i<484;i++){await h.node('privacyAutoNext').onclick();h.confirm();}
 await h.apply();assert.equal(oversizedWrites,0);assert.equal(h.context.editHistory.undo.length,1);assert.equal(h.pages.every(page=>page.annots.length>0),true);
 const saved=h.context.editHistory.undo[0];
 assert.equal(saved.before.extraBytes,JSON.stringify(saved.before.pageOcr).length*2);assert.equal(saved.after.extraBytes,JSON.stringify(saved.after.pageOcr).length*2);
});

test('applying candidates atomically sanitizes OCR, retires checkpoints and preserves before/after data for undo',async()=>{
 const h=harness({count:2});h.open();await h.find();h.confirm();await h.node('privacyAutoNext').onclick();h.confirm();await h.apply();
 assert.equal(h.context.editHistory.undo.length,1);assert.equal(h.node('privacyAutoDialog').open,false);assert.equal(h.context.ocrCheckpoints.size,0);
 for(const p of h.pages){assert.equal(p.annots.length,1);const r=h.context.ocrRecords.find(r=>r.uid===p.uid);assert.equal(r.text,'PUBLIC');assert.equal(r.key,h.context.ocrKey(p,h.options));assert.equal(r.privacyKey,privacy.maskKey(p));assert.equal(JSON.stringify(r).includes('900101'),false);}
 const saved=h.context.editHistory.undo[0];assert.ok(saved.before.extraBytes>0);assert.ok(saved.after.extraBytes>0);assert.equal(saved.before.rows[0].annots.length,0);assert.equal(saved.after.rows[0].annots.length,1);
 assert.match(saved.before.pageOcr[0].record.text,/900101/);assert.equal(saved.after.pageOcr[0].record.text,'PUBLIC');
 assert.equal(h.context.editHistory.take().state.pageOcr[0].record,h.records[0]);assert.equal(h.context.editHistory.take(true).state.pageOcr[0].record.text,'PUBLIC');
});

test('stale OCR changes, including changes during the final source check, prevent every document mutation',async()=>{
 for(const late of [false,true]){
  const h=harness({count:2,onSupported:(c,n)=>{if(late&&n.supported===2)c.ocrRecords[0].words[0].text='990101-1234567';}});h.open();await h.find();h.confirm();await h.node('privacyAutoNext').onclick();h.confirm();if(!late)h.records[0].words[0].text='990101-1234567';await h.apply();
  assert.ok(h.pages.every(p=>!p.annots.length));assert.equal(h.context.editHistory.undo.length,0);assert.equal(h.context.ocrCheckpoints.size,2);assert.equal(h.context.annoUidSeq,20);assert.match(h.node('privacyAutoStatus').textContent,/바뀌었|변경되었/);assert.equal(h.node('privacyAutoStatus').dataset.error,'true');
 }
});

test('allocation and history failures roll back all page, OCR, checkpoint and history state',async()=>{
 for(const failure of [{sanitizeFailure:2},{captureFailure:2},{historyFailure:true}]){
  const h=harness({count:2,...failure}),beforeRecords=h.context.ocrRecords,oldAnnots=h.pages.map(p=>p.annots);h.context.editHistory.redo.push({label:'prior redo'});
  h.open();await h.find();h.confirm();await h.node('privacyAutoNext').onclick();h.confirm();await h.apply();
  for(let i=0;i<h.pages.length;i++)assert.equal(h.pages[i].annots,oldAnnots[i]);assert.equal(h.context.ocrRecords,beforeRecords);assert.equal(h.context.ocrCheckpoints.size,2);assert.equal(h.context.annoUidSeq,20);assert.equal(h.context.editHistory.undo.length,0);assert.equal(h.context.editHistory.redo[0].label,'prior redo');assert.match(h.node('privacyAutoStatus').textContent,/failed/);assert.equal(h.node('privacyAutoStatus').dataset.error,'true');
 }
});

test('no-candidate and unsupported-source messages remain visible after final UI synchronization',async()=>{
 const empty=harness();empty.records[0].words=[empty.records[0].words[1]];empty.records[0].text='PUBLIC';empty.open();await empty.find();assert.match(empty.node('privacyAutoSetupStatus').textContent,/후보가 없습니다/);
 const failed=harness({onSupported:()=>{throw Error('layered source is unsupported');}});failed.open();await failed.find();assert.match(failed.node('privacyAutoSetupStatus').textContent,/layered source/);assert.equal(failed.node('privacyAutoSetupStatus').dataset.error,'true');
 failed.node('privacyAutoScope').onchange();assert.doesNotMatch(failed.node('privacyAutoSetupStatus').textContent,/layered source/);
});

test('apply locks candidate and settings controls and ignores repeated operations',async()=>{
 const h=harness();h.open();await h.find();h.confirm();const pending=h.apply();
 for(const id of ['privacyAutoPreset','privacyAutoScope','privacyAutoStyle','privacyAutoPresetSave'])assert.equal(h.node(id).disabled,true,id);
 const checkbox=h.node('privacyAutoCandidates').querySelector('input');assert.equal(checkbox.disabled,true);checkbox.checked=false;checkbox.onchange();assert.equal(checkbox.checked,true);
 h.node('privacyAutoClearSelection').onclick();h.node('privacyAutoEditSettings').onclick();await h.apply();await pending;assert.equal(h.context.editHistory.undo.length,1);
});

test('dragging only updates active overlay geometry without scrolling the surrounding mobile workspace',async()=>{
 const h=harness();h.open();await h.find();h.confirm();const overlay=h.node('privacyAutoOverlay'),target=overlay.querySelector('[data-id]');
 const event={target,button:0,pointerId:1,clientX:100,clientY:200,preventDefault(){}};overlay.onpointerdown(event);const clearCount=h.counters.overlayClears,scrollCount=h.counters.scrollIntoView;
 overlay.onpointermove({...event,clientX:120,clientY:215});assert.equal(h.counters.overlayClears,clearCount);assert.equal(h.counters.scrollIntoView,scrollCount);assert.equal(h.node('privacyAutoApply').disabled,true);overlay.onpointerup(event);assert.equal(h.node('privacyAutoApply').disabled,true);
});

test('saved presets contain settings only and selecting one restores its name for an update',()=>{
 const h=harness();h.open();h.node('privacyAutoPresetName').value='회사 공유용';h.node('privacyAutoPresetSave').onclick();const saved=JSON.parse([...h.stored.values()][0]);
 assert.equal(saved.length,1);assert.equal(saved[0].name,'회사 공유용');assert.equal(JSON.stringify(saved).includes('900101'),false);assert.deepEqual(Object.keys(saved[0]).sort(),['id','name','style','types']);
 h.node('privacyAutoPresetName').value='';h.node('privacyAutoPreset').value=saved[0].id;h.node('privacyAutoPreset').onchange();assert.equal(h.node('privacyAutoPresetName').value,'회사 공유용');
});
