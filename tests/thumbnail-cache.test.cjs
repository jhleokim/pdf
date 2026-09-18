const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/thumbnail-cache.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function canvas(){return {width:300,height:400,getContext:()=>({translate(){},rotate(){},drawImage(){}})};}
function element(){const bitmap=canvas(),overlay={setAttribute(){}},classes=new Set();return {bitmap,overlay,style:{setProperty(){}},classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)},querySelector:s=>s==='.thumbnail-markup'?overlay:bitmap,getBoundingClientRect:()=>({width:200})};}
function harness(count=5000,renderer=async()=>canvas()){
 const pages=Array.from({length:count},(_,i)=>({uid:'p'+i,docId:'d',srcIndex:i,rotation:0,canvas:null,el:element()}));
 // Any full-document search from an observer batch is a scalability regression.
 pages.find=pages.includes=()=>{throw Error('Thumbnail observer scanned all pages');};
 let callback;const docs=new Map([['d',{pdfjsDoc:{}}]]);
 const ctx=vm.createContext({pages,docs,renderThumb:renderer,idle:tick,thumbnailSignatures:new WeakMap(),syncPageThumbnail(){},IntersectionObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){}}});
 vm.runInContext(source+';this.state=()=>({running:thumbRunning,queued:thumbQueue.length,cached:thumbLRU.size});',ctx);
 ctx.resetThumbnailObserver();for(const p of pages)ctx.observeThumbnail(p);
 return {ctx,pages,docs,emit:entries=>callback(entries),visible:(start,end,on=true)=>callback(pages.slice(start,end).map(p=>({target:p.el,isIntersecting:on}))),async settle(){for(let i=0;i<10000&&ctx.state().running;i++)await tick();assert.equal(ctx.state().running,false);}};
}
test('5,000-page thumbnail scrolling retains only 24 raster pairs and performs indexed lookups',async()=>{
 const h=harness();let previous=[];
 for(let start=0;start<240;start+=12){
   h.emit(previous.map(p=>({target:p.el,isIntersecting:false})));previous=h.pages.slice(start,start+12);h.visible(start,start+12);await h.settle();
   assert.ok(h.ctx.state().cached<=24);assert.ok(h.pages.filter(p=>p.canvas).length<=24);
 }
 assert.equal(h.pages[0].canvas,null);assert.equal(h.pages[0].el.bitmap.width,1);assert.equal(h.pages[0].el.bitmap.height,1);
 assert.ok(previous.every(p=>p.canvas?.width===300));
});
test('scrolling out while PDF.js renders releases its late canvas instead of caching it',async()=>{
 let finish;const rendered=canvas(),h=harness(1,()=>new Promise(r=>{finish=r;}));
 h.visible(0,1);h.visible(0,1,false);finish(rendered);await h.settle();
 assert.equal(rendered.width,0);assert.equal(rendered.height,0);assert.equal(h.pages[0].canvas,null);assert.equal(h.ctx.state().cached,0);
});
test('rebuilding the board during rendering discards stale pixels and renders the new card once',async()=>{
 let finish,calls=0;const oldCanvas=canvas(),h=harness(1,()=>++calls===1?new Promise(r=>{finish=r;}):Promise.resolve(canvas()));
 const p=h.pages[0],oldElement=p.el;h.visible(0,1);h.ctx.resetThumbnailObserver();p.el=element();h.ctx.observeThumbnail(p);h.visible(0,1);
 // IntersectionObserver may deliver a queued record for a disconnected target.
 h.emit([{target:oldElement,isIntersecting:true}]);finish(oldCanvas);await h.settle();
 assert.equal(oldCanvas.width,0);assert.equal(calls,2);assert.equal(p.canvas.width,300);assert.equal(h.ctx.state().cached,1);
});
test('deleted pages and replaced source PDFs cannot publish pending thumbnail results',async()=>{
 let finish;const rendered=canvas(),h=harness(1,()=>new Promise(r=>{finish=r;}));h.visible(0,1);
 h.docs.set('d',{pdfjsDoc:{}});finish(rendered);await h.settle();assert.equal(rendered.width,0);assert.equal(h.pages[0].canvas,null);
 const raster=canvas();h.pages[0].canvas=raster;h.ctx.paintThumbnail(h.pages[0]);h.pages.length=0;h.ctx.resetThumbnailObserver();assert.equal(raster.width,0);assert.equal(h.ctx.state().cached,0);
});
