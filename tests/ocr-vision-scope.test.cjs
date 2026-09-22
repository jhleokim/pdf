'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/pro-vision-ui.js'),'utf8');
function setup(){
 const nodes=new Map(),calls=[],notices=[],pages=[{uid:'one'},{uid:'two'}];
 const node=id=>{
  if(!nodes.has(id)){
   const listeners=new Map(),item={value:id==='ocrLanguage'?'kor+eng':'',checked:false,disabled:false,open:false,
    addEventListener:(name,fn)=>listeners.set(name,fn),showModal(){this.open=true;},close(){this.open=false;listeners.get('close')?.();}};
   nodes.set(id,item);
  }
  return nodes.get(id);
 };
 const ctx=vm.createContext({AbortController,setTimeout,clearTimeout,pages,ocrRunning:false,proAbort:null,$:node,
  ocrDefaultProvider:()=> 'vision',toolTargets:()=>pages,readProOptions:()=>({}),proFingerprint:()=> 'same-document',ocrKey:p=>p.uid,
  PDFVision:{available:async()=>({available:true})},toast:message=>notices.push(message),runOCR:(...args)=>calls.push(args)});
 vm.runInContext(source,ctx);return {ctx,node,calls,notices};
}

test('Vision consent cannot silently expand from gap OCR to whole-page document transmission',async()=>{
 const h=setup();await h.ctx.requestVisionOCR(false);
 assert.match(h.node('visionConfirmScope').textContent,/기존 텍스트 영역을 제외/);
 h.node('visionConsent').checked=true;h.node('visionConsent').onchange();
 h.node('ocrWholePage').checked=true;h.node('visionConfirm').onclick();
 assert.equal(h.calls.length,0);assert.equal(h.node('visionDialog').open,false);assert.match(h.notices[0],/설정이 바뀌었습니다/);
});

test('Vision whole-page request names its transmission scope and carries the consented flag into OCR',async()=>{
 const h=setup();h.node('ocrWholePage').checked=true;await h.ctx.requestVisionOCR(false);
 assert.match(h.node('visionConfirmScope').textContent,/개인정보를 포함한 페이지 전체/);
 assert.equal(h.calls.length,0);h.node('visionConfirm').onclick();assert.equal(h.calls.length,0);
 h.node('visionConsent').checked=true;h.node('visionConsent').onchange();h.node('visionConfirm').onclick();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0][1],'vision');assert.equal(h.calls[0][3],true);assert.equal(h.calls[0][5],true);
 assert.equal(h.node('visionDialog').open,false);
});
