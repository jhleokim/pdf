/* Web-only public engine assets. No document is passed to this loader. */
(() => {
  const loaded=new Map();
  globalThis.PDFTesseractAssets=loaded;
  globalThis.PDFTesseractLoad=async(language,fast,signal,onProgress)=>{
    const ids=['ocr-client','ocr-worker',fast?'ocr-core-fast':'ocr-core','ocr-lang-eng',...(language==='eng'?[]:['ocr-lang-kor'])];
    const entries=ids.map(id=>[id,globalThis.PDFTesseractManifest[id]]),total=entries.reduce((n,[,e])=>n+e.bytes,0);let completed=0;
    const emit=()=>onProgress?.({status:'loading assets',progress:completed/total,detail:'Tesseract 데이터 준비'});
    emit();
    for(const [id,entry] of entries){
      signal?.throwIfAborted();
      if(!loaded.has(id)){
        const response=await fetch(entry.url,{signal,credentials:'omit',cache:'force-cache'});
        if(!response.ok||!response.body)throw Error('Tesseract 데이터를 받지 못했습니다. 연결을 확인하고 다시 시도하세요.');
        const reader=response.body.getReader(),bytes=new Uint8Array(entry.bytes);let offset=0;
        const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
        try{while(true){signal?.throwIfAborted();const {done,value}=await reader.read();signal?.throwIfAborted();if(done)break;if(offset+value.length>bytes.length){await reader.cancel();throw Error('인식 데이터 크기가 일치하지 않습니다.');}bytes.set(value,offset);offset+=value.length;}}
        finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
        if(offset!==entry.bytes)throw Error('인식 데이터를 끝까지 받지 못했습니다.');
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
        signal?.throwIfAborted();if(digest!==entry.sha256)throw Error('인식 데이터가 손상됐습니다. 페이지를 새로 열어 주세요.');
        loaded.set(id,bytes);
      }
      completed+=entry.bytes;emit();
    }
    signal?.throwIfAborted();
  };
})();
