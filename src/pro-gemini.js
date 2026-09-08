/* Optional online OCR. No request is made until the user opens the consent dialog. */
(() => {
  'use strict';
  const endpoint=()=>location.protocol==='file:'?'https://pdf.hanatrust.workers.dev/api/ocr/gemini':new URL('/api/ocr/gemini',location.href).href;
  async function responseJSON(response){
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Gemini 연결이 아직 설정되지 않았습니다.');
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Gemini 인식에 실패했습니다.');return data;
  }
  async function available(signal){return responseJSON(await fetch(endpoint(),{method:'GET',signal,credentials:'omit',cache:'no-store'}));}
  async function session(language,signal,onProgress,consent){
    if(consent!==true)throw new Error('민감정보 없는 문서임을 먼저 확인해 주세요.');
    return {close:async()=>{},async recognize(canvas){
      signal.throwIfAborted();onProgress?.({status:'sending page'});
      const image=canvas.toDataURL('image/jpeg',.94).split(',')[1];
      if(image.length>8*1024*1024)throw new Error('이 페이지 이미지가 너무 큽니다. 페이지 크기를 줄인 뒤 다시 시도하세요.');
      const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),90000),abort=()=>timeout.abort();
      signal.addEventListener('abort',abort,{once:true});
      try{
        signal.throwIfAborted();
        const data=await responseJSON(await fetch(endpoint(),{method:'POST',signal:timeout.signal,credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true,language,image,mimeType:'image/jpeg'})}));
        signal.throwIfAborted();
        if(!Array.isArray(data.lines))throw new Error('Gemini 결과 형식이 올바르지 않습니다.');
        const words=data.lines.map(line=>{
          if(typeof line.text!=='string'||!Array.isArray(line.box)||line.box.length!==4||!line.box.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000))throw new Error('Gemini 줄 위치를 확인하지 못했습니다.');
          const [t,l,b,r]=line.box;if(r<=l||b<=t)throw new Error('Gemini 줄 위치를 확인하지 못했습니다.');
          return {text:line.text,box:[l/1000,t/1000,r/1000,b/1000],separator:'\n',confidence:null,uncertain:!!line.uncertain};
        });
        return {text:words.map(w=>w.text).join('\n'),words,confidence:null,source:'gemini',model:data.model};
      }catch(e){signal.throwIfAborted();if(timeout.signal.aborted)throw new Error('Gemini 응답 시간이 초과됐습니다. 잠시 후 다시 시도하세요.');throw e;}
      finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
    }};
  }
  globalThis.PDFGemini={available,session};
})();
