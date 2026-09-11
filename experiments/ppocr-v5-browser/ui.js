async function createPPV5({signal,onProgress}){
 const worker=new Worker(globalThis.PPV5_ASSETS?.['worker.js']||'worker.js');let pending,timer;
 function close(){clearTimeout(timer);worker.terminate();signal.removeEventListener('abort',cancel);}
 const cancel=()=>{pending?.reject(new DOMException('취소','AbortError'));pending=null;close();};signal.addEventListener('abort',cancel,{once:true});
 worker.onmessage=({data})=>{if(data.type==='progress'){onProgress(data.label,data.progress);return;}clearTimeout(timer);if(data.type==='error')pending?.reject(new Error(data.message));else pending?.resolve(data.result);pending=null;};
 worker.onerror=e=>{pending?.reject(new Error(e.message||'작업 스레드 오류'));pending=null;close();};
 const request=(data,transfer=[])=>new Promise((resolve,reject)=>{pending={resolve,reject};timer=setTimeout(()=>{reject(new Error('페이지 처리 180초 제한'));pending=null;close();},180000);worker.postMessage(data,transfer);});
 try{await request({type:'init',urls:globalThis.PPV5_ASSETS});}catch(e){close();throw e;}
 return {async recognize(canvas,{size}){const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);return request({type:'recognize',size,width:canvas.width,height:canvas.height,pixels:image.data.buffer},[image.data.buffer]);},async close(){close();}};
}
pdfjsLib.GlobalWorkerOptions.workerSrc=globalThis.PPV5_ASSETS?.['pdf.worker.js']||'pdf.worker.js';
const el=id=>document.getElementById(id);let results=[],canvases=[],abort;
function show(){const i=Number(el('page').value),r=results[i],src=canvases[i];if(!r)return;const c=el('preview');c.width=src.width;c.height=src.height;const x=c.getContext('2d');x.drawImage(src,0,0);x.lineWidth=2;
 for(const w of r.words){x.strokeStyle=w.confidence<.8?'#b3261e':'#008477';x.beginPath();w.quad.forEach((p,j)=>j?x.lineTo(...p):x.moveTo(...p));x.closePath();x.stroke();}el('text').textContent=r.text;}
el('page').onchange=show;el('cancel').onclick=()=>abort?.abort();
el('run').onclick=async()=>{
 const files=[...el('files').files];if(!files.length)return;abort=new AbortController();results=[];canvases=[];el('text').textContent='';el('preview').width=0;el('preview').height=0;el('progress').value=0;el('metrics').textContent='';el('page').textContent='';el('run').disabled=true;el('cancel').disabled=false;el('save').disabled=true;let engine;const documents=[],items=[];const total=performance.now();
 try{
 el('status').textContent='문서 준비';
 for(const file of files){
  if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
   const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer(),useSystemFonts:true,isEvalSupported:false}).promise;documents.push(pdf);
   for(let page=1;page<=pdf.numPages;page++)items.push({pdf,page});
  }else items.push({file});
 }if(items.length>12)throw Error('시험판은 한 번에 최대 12페이지를 지원합니다.');
 abort.signal.throwIfAborted();
 engine=await createPPV5({signal:abort.signal,onProgress:(label,n)=>{el('status').textContent=label;el('progress').value=((results.length+(n||0))/items.length)*100;}});
 for(const item of items){abort.signal.throwIfAborted();const c=document.createElement('canvas');
 if(item.pdf){const page=await item.pdf.getPage(item.page),base=page.getViewport({scale:1}),vp=page.getViewport({scale:2367/Math.max(base.width,base.height)});c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);await page.render({canvasContext:c.getContext('2d'),viewport:vp,background:'white'}).promise;}
 else{const bitmap=await createImageBitmap(item.file);c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();}
 const r=await engine.recognize(c,{size:Number(el('size').value)});results.push(r);canvases.push(c);const index=results.length;
 const row=el('metrics').insertRow();for(const v of [index,(r.elapsedMs/1000).toFixed(2),r.detected,r.words.length,r.text.length])row.insertCell().textContent=v;
 el('page').add(new Option(index+'페이지',index-1));el('page').value=index-1;show();el('save').disabled=false;
 }el('progress').value=100;el('status').textContent='완료 · '+results.length+'페이지 · 전체 '+((performance.now()-total)/1000).toFixed(2)+'초 (준비 포함)';
 }catch(e){el('status').textContent=abort.signal.aborted?'취소 · 완료한 페이지는 유지됩니다.':'실패: '+e.message;console.error(e);}
 finally{await engine?.close();for(const pdf of documents)await pdf.destroy();el('run').disabled=false;el('cancel').disabled=true;}
};
el('save').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({results},null,2)],{type:'application/json'}));a.download='ppocr-v5-local-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
