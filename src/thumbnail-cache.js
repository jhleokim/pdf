/* Keep visible thumbnails plus a small LRU. Document metadata stays available. */
let thumbObserver=null,thumbQueue=[],thumbRunning=false;
const thumbLRU=new Map(),thumbVisible=new Set(),THUMB_LIMIT=24;
function resetThumbnailObserver(){thumbObserver?.disconnect();thumbVisible.clear();thumbQueue=[];trimThumbnails();}
function releaseThumbnail(p){if(p.canvas){p.canvas.width=p.canvas.height=0;p.canvas=null;}const c=p.el?.querySelector('.page-thumbnail canvas');if(c)c.width=c.height=1;thumbLRU.delete(p);}
function trimThumbnails(){for(const [p]of thumbLRU){if(!pages.includes(p)||thumbLRU.size>THUMB_LIMIT&&!thumbVisible.has(p))releaseThumbnail(p);}}
function paintThumbnail(p){
  const canvas=p.el?.querySelector('.page-thumbnail canvas');if(!canvas||!p.canvas)return;
  const swap=p.rotation%180;canvas.width=swap?p.canvas.height:p.canvas.width;canvas.height=swap?p.canvas.width:p.canvas.height;
  const ctx=canvas.getContext('2d');ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(p.rotation*Math.PI/180);ctx.drawImage(p.canvas,-p.canvas.width/2,-p.canvas.height/2);
  const overlay=p.el.querySelector('.thumbnail-markup');overlay.setAttribute('viewBox',`0 0 ${canvas.width} ${canvas.height}`);thumbnailSignatures.delete(overlay);syncPageThumbnail(p);p.el.classList.remove('thumb-placeholder');
  thumbLRU.delete(p);thumbLRU.set(p,true);trimThumbnails();
}
async function drainThumbnails(){
  if(thumbRunning)return;thumbRunning=true;
  try{while(thumbQueue.length){const p=thumbQueue.shift();if(!pages.includes(p)||!thumbVisible.has(p))continue;
    try{if(!p.canvas){const source=docs.get(p.docId);if(!source)continue;const c=await renderThumb(source.pdfjsDoc,p.srcIndex+1,Math.min(300,Math.max(56,p.el.getBoundingClientRect().width)));if(!pages.includes(p)){c.width=c.height=0;continue;}p.canvas=c;}paintThumbnail(p);}catch(_){p.el?.classList.add('thumb-placeholder');}
    await idle();
  }}finally{thumbRunning=false;trimThumbnails();}
}
function observeThumbnail(p){
  p.el.classList.add('thumb-placeholder');const thumb=p.el.querySelector('.page-thumbnail');const ratio=p.thumbRatio||.7071;thumb.style.aspectRatio=String(p.rotation%180?1/ratio:ratio);
  if(p.canvas)paintThumbnail(p);
  if(typeof IntersectionObserver==='undefined'){thumbVisible.add(p);thumbQueue.push(p);void drainThumbnails();return;}
  if(!thumbObserver)thumbObserver=new IntersectionObserver(entries=>{for(const e of entries){const page=pages.find(p=>p.el===e.target);if(!page)continue;if(e.isIntersecting){thumbVisible.add(page);if(page.canvas)paintThumbnail(page);else if(!thumbQueue.includes(page))thumbQueue.push(page);}else thumbVisible.delete(page);}trimThumbnails();void drainThumbnails();},{rootMargin:'240px'});
  thumbObserver.observe(p.el);
}
