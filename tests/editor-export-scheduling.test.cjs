const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(require('node:path').join(__dirname,'../src/editor.js'),'utf8');
const build=code.slice(code.indexOf('async function buildEditedDocument('),code.indexOf('function downloadPdf('));
function harness({abortOnYield=false}={}){
 const list=Array.from({length:500},(_,i)=>({uid:'page-'+i,docId:'doc',srcIndex:i,rotation:0,annots:[]})),controller=new AbortController(),visited=[];
 let ticks=0,yields=0,redactions=0;const out={getPage:i=>{visited.push(i);return {};}};
 const context=vm.createContext({docs:new Map([['doc',{count:500,libBytes:new Uint8Array([1])}]]),performance:{now:()=>++ticks},
  PDFDocument:{load:async()=>out},PDFPrivacy:{isMasked:()=>false,clearCache(){},redact:async(doc,rows,{signal})=>{signal?.throwIfAborted();assert.equal(doc,out);assert.equal(rows,list);redactions++;return doc;}},
  idle:async()=>{yields++;if(abortOnYield)controller.abort();}
 });vm.runInContext(build,context);
 return {list,visited,controller,run:onProgress=>context.buildEditedDocument(list,{signal:controller.signal,onProgress}),get yields(){return yields;},get redactions(){return redactions;}};
}

test('500 native pages batch progress and timers while preserving order and final completion',async()=>{
 const h=harness(),progress=[];await h.run((n,total)=>progress.push([n,total]));
 assert.deepEqual(h.visited,Array.from({length:500},(_,i)=>i));assert.ok(h.yields>=20&&h.yields<=22);assert.equal(progress.length,h.yields);assert.deepEqual(progress.at(-1),[500,500]);
 assert.ok(progress.every(([done,total],i)=>total===500&&done>(progress[i-1]?.[0]||0)));assert.equal(h.redactions,1);
});

test('without a progress callback native export still yields and observes cancellation before finishing',async()=>{
 const h=harness({abortOnYield:true});await assert.rejects(h.run(),e=>e.name==='AbortError');assert.equal(h.yields,1);assert.ok(h.visited.length>0&&h.visited.length<500);assert.equal(h.redactions,0);
});

test('cancelling at final progress prevents the next redaction/save stage',async()=>{
 const h=harness();await assert.rejects(h.run((n,total)=>{if(n===total)h.controller.abort();}),e=>e.name==='AbortError');assert.equal(h.visited.length,500);assert.equal(h.redactions,0);
});
