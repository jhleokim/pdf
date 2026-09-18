/* Keep visible thumbnails plus a small LRU. Document metadata stays available. */
let thumbObserver=null,thumbQueue=[],thumbRunning=false,thumbGeneration=0;
const thumbLRU=new Map(),thumbVisible=new Set(),thumbQueued=new Set(),thumbPages=new Set(),thumbTargets=new WeakMap(),THUMB_LIMIT=24;
function syncThumbnailRatio(p){
  const natural=p.thumbRatio||(p.canvas?.height?p.canvas.width/p.canvas.height:Math.SQRT1_2);
  const ratio=p.rotation%180?1/natural:natural;
  p.el?.style.setProperty('--page-ratio',String(ratio));
}
function resetThumbnailObserver(){
  ++thumbGeneration;thumbObserver?.disconnect();thumbVisible.clear();thumbQueue=[];thumbQueued.clear();
  thumbPages.clear();for(const p of pages)thumbPages.add(p);trimThumbnails();
}
function releaseThumbnail(p){if(p.canvas){p.canvas.width=p.canvas.height=0;p.canvas=null;}const c=p.el?.querySelector('.page-thumbnail canvas');if(c)c.width=c.height=1;p.el?.classList.add('thumb-placeholder');thumbLRU.delete(p);}
function trimThumbnails(){for(const [p]of thumbLRU){if(!thumbPages.has(p)||thumbLRU.size>THUMB_LIMIT&&!thumbVisible.has(p))releaseThumbnail(p);}}
function queueThumbnail(p){if(!thumbQueued.has(p)){thumbQueued.add(p);thumbQueue.push(p);}}
function paintThumbnail(p){
  const canvas=p.el?.querySelector('.page-thumbnail canvas');if(!canvas||!p.canvas)return;
  p.thumbRatio=p.canvas.width/p.canvas.height;syncThumbnailRatio(p);
  const swap=p.rotation%180;canvas.width=swap?p.canvas.height:p.canvas.width;canvas.height=swap?p.canvas.width:p.canvas.height;
  const ctx=canvas.getContext('2d');ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(p.rotation*Math.PI/180);ctx.drawImage(p.canvas,-p.canvas.width/2,-p.canvas.height/2);
  const overlay=p.el.querySelector('.thumbnail-markup');overlay.setAttribute('viewBox',`0 0 ${canvas.width} ${canvas.height}`);thumbnailSignatures.delete(overlay);syncPageThumbnail(p);p.el.classList.remove('thumb-placeholder');
  thumbLRU.delete(p);thumbLRU.set(p,true);trimThumbnails();
}
async function drainThumbnails(){
  if(thumbRunning)return;thumbRunning=true;
  try{while(thumbQueue.length){const p=thumbQueue.shift();thumbQueued.delete(p);if(!thumbPages.has(p)||!thumbVisible.has(p))continue;
    const generation=thumbGeneration,element=p.el,source=docs.get(p.docId),index=p.srcIndex;
    try{if(!p.canvas){if(!source)continue;const c=await renderThumb(source.pdfjsDoc,index+1,Math.min(300,Math.max(56,element.getBoundingClientRect().width)));
      // A reorder, undo, reset or fast scroll can retire this request while
      // PDF.js renders. Never publish its pixels into a different/current card.
      if(generation!==thumbGeneration||!thumbPages.has(p)||!thumbVisible.has(p)||p.el!==element||docs.get(p.docId)!==source||p.srcIndex!==index){c.width=c.height=0;continue;}
      p.canvas=c;
    }paintThumbnail(p);}catch(_){if(generation===thumbGeneration&&p.el===element)p.el?.classList.add('thumb-placeholder');}
    await idle();
  }}finally{thumbRunning=false;trimThumbnails();}
}
function observeThumbnail(p){
  thumbPages.add(p);thumbTargets.set(p.el,p);p.el.classList.add('thumb-placeholder');syncThumbnailRatio(p);
  if(p.canvas)paintThumbnail(p);
  if(typeof IntersectionObserver==='undefined'){thumbVisible.add(p);queueThumbnail(p);void drainThumbnails();return;}
  if(!thumbObserver)thumbObserver=new IntersectionObserver(entries=>{for(const e of entries){const page=thumbTargets.get(e.target);if(!page||page.el!==e.target||!thumbPages.has(page))continue;if(e.isIntersecting){thumbVisible.add(page);if(page.canvas)paintThumbnail(page);else queueThumbnail(page);}else thumbVisible.delete(page);}trimThumbnails();void drainThumbnails();},{rootMargin:'240px'});
  thumbObserver.observe(p.el);
}
