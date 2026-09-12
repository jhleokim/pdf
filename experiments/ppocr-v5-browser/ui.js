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
const el=id=>document.getElementById(id);let results=[],canvases=[],abort,running=false,correcting=false,runId=0;
function setProgress(value){const n=Math.max(0,Math.min(100,value));el('progress').value=n;el('progressValue').value=Math.floor(n)+'%';}
function syncActions(){el('run').disabled=running||correcting;el('files').disabled=el('size').disabled=running||correcting;el('cancel').disabled=!running;el('save').disabled=!results.length||running||correcting;el('correct').disabled=!results.length||running||correcting;el('page').disabled=!results.length||correcting;}
function updateMetrics(){el('metrics').replaceChildren();results.forEach((r,i)=>{const row=el('metrics').insertRow();for(const v of [i+1,(r.elapsedMs/1000).toFixed(2),r.detected,r.words.filter(w=>w.text?.trim()).length,r.text.length])row.insertCell().textContent=v;});}
function show(){const i=Number(el('page').value),r=results[i],src=canvases[i],c=el('preview');el('imageEmpty').hidden=el('textEmpty').hidden=!!r;c.hidden=!r;if(!r){el('text').textContent='';return;}c.width=src.width;c.height=src.height;const x=c.getContext('2d');x.drawImage(src,0,0);x.lineWidth=Math.max(1,src.width/900);
 for(const w of r.words){if(!w.text?.trim())continue;x.strokeStyle=w.confidence<.8&&!w.corrected?'rgba(163,113,50,.8)':'rgba(0,133,125,.72)';x.beginPath();if(w.quad?.length===4){w.quad.forEach((p,j)=>j?x.lineTo(...p):x.moveTo(...p));x.closePath();}else if(w.box){const [l,t,rr,b]=w.box;x.rect(l*c.width,t*c.height,(rr-l)*c.width,(b-t)*c.height);}x.stroke();}el('text').textContent=r.text;el('textCount').textContent=r.words.filter(w=>w.text?.trim()).length+'개 글줄 · '+r.text.length.toLocaleString()+'자';el('resultSummary').textContent=results.length+'페이지 인식';}
el('page').onchange=show;el('cancel').onclick=()=>abort?.abort();
el('theme').onclick=()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';el('theme').textContent=dark?'라이트 모드':'다크 모드';el('theme').setAttribute('aria-pressed',String(dark));};
el('files').onchange=()=>{if(!running){el('status').dataset.state='';el('status').textContent=el('files').files.length?el('files').files.length+'개 파일 선택 · 인식을 시작하세요.':'PDF나 이미지를 선택하세요.';}};
el('correct').onclick=async()=>{
 if(running||correcting||!results.length)return;correcting=true;syncActions();const before=results;
 try{await PDFOCRCorrection.open({initialIndex:Number(el('page').value)||0,
  records:before.map((r,i)=>({...r,uid:r.uid||'lab-'+runId+'-'+i,page:i+1,source:'paddle-v5',granularity:'line',words:r.words.map(w=>({...w,confidence:Number.isFinite(w.confidence)?w.confidence*100:null,separator:w.separator??'\n'}))})),
  renderPage:async(record,{signal})=>{signal.throwIfAborted();const source=canvases[record.page-1];if(!source?.width)throw Error('원본 페이지가 변경되었습니다. 교정 창을 다시 열어 주세요.');return source;},
  onApply:records=>{if(results!==before||running)throw Error('인식 결과가 변경되었습니다. 교정 창을 다시 열어 주세요.');results=records.map((record,i)=>({...record,source:before[i].source,words:record.words.map(w=>({...w,confidence:Number.isFinite(w.confidence)?w.confidence/100:null}))}));updateMetrics();show();el('status').dataset.state='';el('status').textContent='교정 내용을 적용했습니다. 텍스트와 JSON 내보내기에 반영됩니다.';}
 });}catch(error){el('status').dataset.state='error';el('status').textContent=error.message||'교정 창을 열지 못했습니다.';}finally{correcting=false;syncActions();}
};
el('run').onclick=async()=>{
 if(running||correcting)return;const files=[...el('files').files];if(!files.length){el('status').textContent='먼저 PDF나 이미지를 선택하세요.';el('files').focus();return;}abort=new AbortController();running=true;runId++;for(const canvas of canvases)canvas.width=canvas.height=0;results=[];canvases=[];el('text').textContent='';el('preview').width=0;el('preview').height=0;setProgress(0);el('metrics').textContent='';el('page').textContent='';el('status').dataset.state='';el('resultSummary').textContent='원본과 인식 결과';el('textCount').textContent='확인 후 교정할 수 있습니다';show();syncActions();let engine;const documents=[],items=[];const total=performance.now();
 try{
 el('status').textContent='문서 준비';
 for(const file of files){
  if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
   const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer(),useSystemFonts:true,isEvalSupported:false}).promise;documents.push(pdf);
   for(let page=1;page<=pdf.numPages;page++)items.push({pdf,page});
  }else items.push({file});
 }if(items.length>12)throw Error('시험판은 한 번에 최대 12페이지를 지원합니다.');
 abort.signal.throwIfAborted();
 engine=await createPPV5({signal:abort.signal,onProgress:(label,n)=>{el('status').textContent=(results.length+1)+' / '+items.length+'페이지 · '+label;setProgress(((results.length+(n||0))/items.length)*100);}});
 for(const item of items){abort.signal.throwIfAborted();const c=document.createElement('canvas');
 try{
 if(item.pdf){const page=await item.pdf.getPage(item.page),base=page.getViewport({scale:1}),vp=page.getViewport({scale:2367/Math.max(base.width,base.height)});c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);const render=page.render({canvasContext:c.getContext('2d'),viewport:vp,background:'white'}),cancel=()=>render.cancel();abort.signal.addEventListener('abort',cancel,{once:true});try{abort.signal.throwIfAborted();await render.promise;}finally{abort.signal.removeEventListener('abort',cancel);}}
 else{const bitmap=await createImageBitmap(item.file);try{const scale=Math.min(1,2367/Math.max(bitmap.width,bitmap.height));c.width=Math.ceil(bitmap.width*scale);c.height=Math.ceil(bitmap.height*scale);c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);}finally{bitmap.close();}}
 abort.signal.throwIfAborted();const r=await engine.recognize(c,{size:Number(el('size').value)});abort.signal.throwIfAborted();r.uid='lab-'+runId+'-'+results.length;results.push(r);canvases.push(c);const index=results.length;
 updateMetrics();el('page').add(new Option(index+'페이지',index-1));el('page').value=index-1;show();syncActions();
 }catch(error){c.width=c.height=0;throw error;}
 }setProgress(100);el('status').textContent='완료 · '+results.length+'페이지 · 전체 '+((performance.now()-total)/1000).toFixed(2)+'초 (준비 포함)';
 }catch(e){el('status').dataset.state=abort.signal.aborted?'':'error';el('status').textContent=abort.signal.aborted?'취소 · 완료한 페이지는 유지됩니다.':'인식하지 못했습니다: '+e.message;if(!abort.signal.aborted)console.error(e);}
 finally{await engine?.close();await Promise.allSettled(documents.map(pdf=>pdf.destroy()));running=false;syncActions();}
};
el('save').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({results},null,2)],{type:'application/json'}));a.download='ppocr-v5-local-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
