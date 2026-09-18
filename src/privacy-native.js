(function(root){
 'use strict';
 let worker=null,workerURL=null,ready=null,initializing=null,pending=null,idleTimer,queue=Promise.resolve(),sequence=0,generation=0;
 function dispose(reason=new DOMException('취소했습니다.','AbortError')){
  generation++;clearTimeout(idleTimer);const init=initializing,active=pending;initializing=pending=null;
  worker?.terminate();worker=null;ready=null;if(workerURL)URL.revokeObjectURL(workerURL);workerURL=null;
  init?.reject(reason);active?.reject(reason);
 }
 async function asset(name,signal){
  const embedded=document.getElementById('privacy-'+name),spec=PDFPrivacyAssets[name];let packed;
  if(embedded)packed=Uint8Array.from(atob(embedded.textContent.trim()),c=>c.charCodeAt(0));
  else{const url=new URL(spec.url,location.href);if(url.origin!==location.origin||!/^https?:$/.test(url.protocol))throw Error('개인정보 삭제 엔진이 이 HTML에 포함되지 않았습니다. 최신 스탠드얼론 파일을 사용해 주세요.');
    const response=await fetch(url,{signal,credentials:'same-origin',cache:'force-cache'});if(!response.ok)throw Error('개인정보 삭제 엔진을 불러오지 못했습니다.');packed=new Uint8Array(await response.arrayBuffer());}
  signal?.throwIfAborted();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',packed)),n=>n.toString(16).padStart(2,'0')).join('');
  if(packed.length!==spec.bytes||hash!==spec.sha256)throw Error('개인정보 삭제 엔진 파일 검증에 실패했습니다.');
  const c=PDFLib.PDFContext.create();return PDFLib.decodePDFRawStream(PDFLib.PDFRawStream.of(c.obj({Filter:'FlateDecode'}),packed)).decode();
 }
 async function start(signal){
  if(ready)return ready;
  const token=++generation;
  ready=(async()=>{
   const [wasm,code]=await Promise.all([asset('wasm',signal),asset('worker',signal)]);signal?.throwIfAborted();
   if(token!==generation)throw new DOMException('취소했습니다.','AbortError');
   // The bundle includes its async WASM bootstrap; no module imports or URLs.
   workerURL=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));worker=new Worker(workerURL,{type:'classic'});
   await new Promise((resolve,reject)=>{
    initializing={reject};
    worker.onerror=e=>{if(token===generation)dispose(Error(e.message||'개인정보 삭제 엔진이 중단되었습니다.'));};
    worker.onmessage=({data:d})=>{
     if(token!==generation)return;
     if(d.ready){initializing=null;return resolve();}
     if(d.error&&!d.id)return reject(Error(d.error));
     if(pending?.id!==d.id)return;if(d.error)pending.reject(Error(d.error));else if(d.result)pending.resolve(d.result);else pending.progress?.(d.done,d.total);
    };
    worker.postMessage({init:true,wasm},[wasm.buffer]);
   });
  })();
  try{await ready;}catch(e){if(token===generation)dispose();throw e;}
 }
 function run(bytes,masks,{signal,onProgress,operation='redact'}={}){
  const job=async()=>{
   signal?.throwIfAborted();clearTimeout(idleTimer);
   let timer,abort,lastDone=0,progressTotal=null;
   try{return await new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(fn,value)=>{if(settled)return;settled=true;fn(value);};
    pending={id:null,resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)};
    const fail=error=>{dispose(error);finish(reject,error);};
    abort=()=>fail(signal?.reason||new DOMException('취소했습니다.','AbortError'));signal?.addEventListener('abort',abort,{once:true});
    const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>fail(Error(operation==='placements'?'이미지 배치 분석 응답이 멈췄습니다.':'개인정보 삭제 처리 응답이 멈췄습니다. 문서는 저장하지 않았습니다.')),operation==='placements'?30000:120000);};
    // Large documents may take several minutes. Bound a stalled page or engine
    // startup, rather than killing a healthy job at a fixed document deadline.
    arm();
    start(signal).then(()=>{
     if(settled)return;signal?.throwIfAborted();arm();
     pending={id:++sequence,resolve:value=>finish(resolve,value),reject:error=>finish(reject,error),progress:(done,total)=>{
      if(!Number.isInteger(done)||!Number.isInteger(total)||total<1||done<=lastDone||done>total||progressTotal!==null&&total!==progressTotal)return;
      progressTotal=total;lastDone=done;arm();onProgress?.(done,total);
     }};
     worker.postMessage({id:pending.id,bytes,masks,operation},[bytes.buffer]);
    },error=>finish(reject,error)).catch(error=>finish(reject,error));
   });}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending=null;idleTimer=setTimeout(dispose,30000);}
  };
  const result=queue.catch(()=>{}).then(job);queue=result.catch(()=>{});return result;
 }
 root.PDFPrivacyNative={run,dispose,placements:(bytes,options)=>run(bytes,null,{...options,operation:'placements'})};addEventListener('pagehide',()=>dispose());
})(globalThis);
