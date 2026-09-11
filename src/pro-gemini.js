/* Optional online OCR. Only explicitly confirmed pages are sent; no persistent cache. */
'use strict';
function createCloudOCRClient(label='Gemini',path='/api/ocr/gemini',provider='gemini',normalize=null){
  const MAX_IMAGE=8*1024*1024,MAX_RESPONSE=2*1024*1024;
  let retryUntil=0;
  const cooldown=()=>Math.max(0,Math.ceil((retryUntil-Date.now())/1000));
  function endpoint(){
    if(!/^https?:$/.test(location.protocol))throw new Error('Gemini 인식은 웹 버전에서 사용할 수 있습니다.');
    return new URL(path,location.href).href;
  }
  function failure(message,code,status,retryAfter){
    const error=new Error(message.replaceAll('Gemini',label));error.code=provider==='vision'?code?.replace(/^GEMINI_/,'VISION_'):code;error.status=status;
    if(Number.isFinite(retryAfter)&&retryAfter>0)error.retryAfter=Math.ceil(retryAfter);
    return error;
  }
  async function responseJSON(response,signal){
    signal.throwIfAborted();
    if(!response.headers.get('content-type')?.toLowerCase().includes('application/json')){
      await response.body?.cancel();throw failure('Gemini 연결 응답을 확인하지 못했습니다. 잠시 후 다시 시도하세요.','GEMINI_CONNECTION',response.status);
    }
    if(Number(response.headers.get('content-length'))>MAX_RESPONSE){await response.body?.cancel();throw failure('Gemini 결과가 너무 큽니다. 페이지를 나누어 주세요.','GEMINI_RESULT_INVALID');}
    if(!response.body)throw failure('Gemini 응답 내용이 없습니다.','GEMINI_RESULT_INVALID');
    const reader=response.body.getReader(),chunks=[];let size=0;
    const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
    try{
      signal.throwIfAborted();
      while(true){
        const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;
        size+=value.length;if(size>MAX_RESPONSE){await reader.cancel();throw failure('Gemini 결과가 너무 큽니다. 페이지를 나누어 주세요.','GEMINI_RESULT_INVALID');}chunks.push(value);
      }
    }finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch(_){throw failure('Gemini 응답 형식을 확인하지 못했습니다.','GEMINI_RESULT_INVALID');}
    if(!data||typeof data!=='object'||Array.isArray(data))throw failure('Gemini 응답 형식을 확인하지 못했습니다.','GEMINI_RESULT_INVALID');
    if(!response.ok){
      const header=response.headers.get('retry-after'),seconds=header?(Number.isFinite(Number(header))?Number(header):(Date.parse(header)-Date.now())/1000):NaN;
      throw failure(typeof data.error==='string'?data.error:'Gemini 인식에 실패했습니다.',data.code,response.status,Number.isFinite(data.retryAfter)?data.retryAfter:seconds);
    }
    return data;
  }
  function abortable(promise,signal){
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
      promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
      if(signal.aborted)abort();
    });
  }
  async function encodeImage(canvas,signal){
    if(!canvas.width||!canvas.height)throw new Error('인식할 페이지 이미지가 없습니다.');
    let blob;
    // Keep resolution and quality unless the image exceeds the API upload cap.
    // toBlob/FileReader avoid synchronous multi-megabyte toDataURL work on the UI thread.
    for(const quality of [.94,.88,.8]){
      signal.throwIfAborted();
      blob=await abortable(new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality)),signal);
      signal.throwIfAborted();if(!blob||blob.type!=='image/jpeg')throw new Error('인식용 이미지를 준비하지 못했습니다.');
      if(4*Math.ceil(blob.size/3)<=MAX_IMAGE)break;
    }
    if(4*Math.ceil(blob.size/3)>MAX_IMAGE)throw new Error('이 페이지 이미지가 너무 큽니다. 페이지 크기를 줄인 뒤 다시 시도하세요.');
    return new Promise((resolve,reject)=>{
      const reader=new FileReader(),cleanup=()=>{signal.removeEventListener('abort',abort);reader.onload=reader.onerror=reader.onabort=null;};
      const abort=()=>{reader.abort();cleanup();reject(signal.reason);};
      reader.onload=()=>{const result=String(reader.result);cleanup();resolve(result.slice(result.indexOf(',')+1));};
      reader.onerror=()=>{cleanup();reject(new Error('인식용 이미지를 읽지 못했습니다.'));};
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}reader.readAsDataURL(blob);
    });
  }
  async function available(signal){const wait=cooldown();if(wait)return {available:true,retryAfter:wait};return responseJSON(await fetch(endpoint(),{method:'GET',signal,credentials:'omit',cache:'no-store'}),signal);}
  async function session(language,signal,onProgress,consent){
    if(consent!==true)throw new Error('민감정보 없는 문서임을 먼저 확인해 주세요.');
    signal.throwIfAborted();const url=endpoint();let closed=false,active=null;
    return {close:async()=>{closed=true;active?.abort();},async recognize(canvas){
      signal.throwIfAborted();if(closed)throw new DOMException('인식이 종료되었습니다.','AbortError');
      const wait=cooldown();if(wait)throw failure('Gemini 호출 한도에 도달했습니다. '+wait+'초 뒤 다시 시도하세요. 한도가 초기화되지 않았다면 더 기다려야 합니다.','GEMINI_QUOTA',429,wait);
      if(active)throw new Error('이전 페이지 인식이 끝난 뒤 다시 시도하세요.');
      const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),90000),abort=()=>timeout.abort();active=timeout;
      signal.addEventListener('abort',abort,{once:true});
      try{
        signal.throwIfAborted();onProgress?.({status:'encoding page'});
        const image=await encodeImage(canvas,timeout.signal);timeout.signal.throwIfAborted();onProgress?.({status:'sending page'});
        const response=await fetch(url,{method:'POST',signal:timeout.signal,credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true,language,image,mimeType:'image/jpeg'})});
        onProgress?.({status:'reading result'});const data=await responseJSON(response,timeout.signal);
        signal.throwIfAborted();if(closed)throw new DOMException('인식이 종료되었습니다.','AbortError');
        if(normalize)return normalize(data);
        if(!Array.isArray(data.lines)||data.lines.length>1500)throw failure('Gemini 결과 형식이 올바르지 않습니다.','GEMINI_RESULT_INVALID');
        let chars=0;
        const words=data.lines.map(line=>{
          if(!line||typeof line.text!=='string'||!line.text.trim()||line.text.length>2000||/[\u0000-\u0008\u000b-\u001f]/.test(line.text)||typeof line.uncertain!=='boolean'||!Array.isArray(line.box)||line.box.length!==4||!line.box.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000))throw failure('Gemini 글자와 줄 위치를 확인하지 못했습니다.','GEMINI_RESULT_INVALID');
          chars+=line.text.length;if(chars>60000)throw failure('Gemini 결과가 너무 큽니다. 페이지를 나누어 주세요.','GEMINI_RESULT_INVALID');
          const [t,l,b,r]=line.box;if(r<=l||b<=t)throw failure('Gemini 줄 위치를 확인하지 못했습니다.','GEMINI_RESULT_INVALID');
          return {text:line.text.trim(),box:[l/1000,t/1000,r/1000,b/1000],separator:'\n',confidence:null,uncertain:line.uncertain};
        });
        return {text:words.map(w=>w.text).join('\n'),words,confidence:null,source:provider,model:data.model};
      }catch(e){
        signal.throwIfAborted();if(closed)throw new DOMException('인식이 종료되었습니다.','AbortError');
        if(e.status===429)retryUntil=Date.now()+Math.max(1,e.retryAfter||60)*1000;
        if(timeout.signal.aborted)throw failure('Gemini 응답 시간이 초과됐습니다. 완료한 페이지는 유지되므로 다시 눌러 이어서 인식하세요.','GEMINI_TIMEOUT',504);
        throw e;
      }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);active=null;}
    }};
  }
  return {available,session};
}
globalThis.PDFGemini=createCloudOCRClient();
