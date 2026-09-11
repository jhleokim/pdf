// Run inference outside the UI thread. Termination does not wait for a hung GPU job.
export async function createWorkerSession(url,signal,onProgress,{WorkerImpl=globalThis.Worker,initTimeout=300000,pageTimeout=120000,idleTimeout=90000}={}){
  signal?.throwIfAborted();
  if(!WorkerImpl)throw Error('이 브라우저에서는 Paddle 작업 스레드를 사용할 수 없습니다. Tesseract를 선택해 주세요.');
  const worker=new WorkerImpl(url,{type:'module'});
  let pending=null,closed=false,sequence=0,deadline=null,idle=null;
  const clear=()=>{clearTimeout(deadline);clearTimeout(idle);deadline=idle=null;};
  const terminate=error=>{if(closed)return;closed=true;clear();signal?.removeEventListener('abort',abort);worker.terminate();const task=pending;pending=null;task?.reject(error);};
  const abort=()=>terminate(signal.reason||new DOMException('취소했습니다.','AbortError'));
  const timeout=phase=>terminate(Object.assign(new Error(phase+' 시간이 초과되어 작업을 종료했습니다. 현재 브라우저 실험판은 글자가 많은 문서에서 완료되지 않을 수 있습니다. Tesseract 또는 활성화한 Google Vision을 이용해 주세요. 다운로드한 모델은 재사용됩니다.'),{code:'PADDLE_TIMEOUT'}));
  const heartbeat=()=>{clearTimeout(idle);idle=setTimeout(()=>timeout('Paddle 응답 대기'),idleTimeout);};
  worker.onmessage=({data})=>{
    if(closed||!pending||data.id!==pending.id)return;
    if(data.type==='progress'){heartbeat();onProgress?.(data.progress);return;}
    const task=pending;pending=null;clear();
    if(data.type==='result')task.resolve(data.result);
    else {const error=Object.assign(new Error(data.error?.message||'Paddle 작업에 실패했습니다. Tesseract를 선택해 주세요.'),{code:data.error?.code||'PADDLE_FAILED'});task.reject(error);terminate(error);}
  };
  worker.onerror=event=>{event.preventDefault?.();terminate(Object.assign(new Error('Paddle 작업 스레드 또는 WebGPU 실행에 실패했습니다. 브라우저를 업데이트하거나 Tesseract를 선택해 주세요.'),{code:'PADDLE_WORKER_FAILED'}));};
  worker.onmessageerror=()=>terminate(new Error('Paddle 결과를 전달하지 못했습니다. 다시 시도해 주세요.'));
  signal?.addEventListener('abort',abort,{once:true});
  const request=(type,payload={},transfer=[])=>new Promise((resolve,reject)=>{
    if(closed){reject(signal?.aborted?signal.reason:new Error('Paddle 작업이 종료되었습니다.'));return;}
    if(pending){reject(new Error('이전 인식 작업이 아직 진행 중입니다.'));return;}
    pending={id:++sequence,resolve,reject};
    deadline=setTimeout(()=>timeout(type==='init'?'Paddle 모델 준비':'Paddle 페이지 인식'),type==='init'?initTimeout:pageTimeout);heartbeat();
    try{worker.postMessage({id:sequence,type,...payload},transfer);}catch(error){terminate(error);}
  });
  try{if(signal?.aborted)abort();await request('init');}
  catch(error){terminate(error);throw error;}
  return {async recognize(canvas){
    signal?.throwIfAborted();if(closed)throw Error('Paddle 작업이 종료되었습니다.');
    const pixels=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
    return request('recognize',{width:pixels.width,height:pixels.height,pixels:pixels.data.buffer},[pixels.data.buffer]);
  },async close(){terminate(new DOMException('인식이 종료되었습니다.','AbortError'));}};
}
