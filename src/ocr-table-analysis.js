/* Table structure runs in a disposable worker; OCR pixels stay on this device. */
(() => {
  'use strict';
  const MAX_EDGE=1600, MAX_WORDS=20000, MAX_CHARS=1000000;
  let running=null;
  const cancelled=()=>new DOMException('작업을 취소했습니다.','AbortError');
  function validBox(box){return Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[0]>=0&&box[1]>=0&&box[2]<=1&&box[3]<=1&&box[2]>box[0]&&box[3]>box[1];}
  function checkCanvas(canvas){if(!Number.isSafeInteger(canvas?.width)||!Number.isSafeInteger(canvas?.height)||canvas.width<1||canvas.height<1||canvas.width*canvas.height>40000000)throw new Error('분석할 원본 페이지 크기를 확인해 주세요.');}
  function analyze(canvas,words,{signal,region}={}){
    signal?.throwIfAborted();
    if(running)return Promise.reject(new Error('현재 표 분석을 완료하거나 취소한 뒤 다시 시도하세요.'));
    checkCanvas(canvas);
    if(region&&!validBox(region))throw new Error('표 영역을 원본 페이지 안에 지정해 주세요.');
    if(!Array.isArray(words)||words.length>MAX_WORDS)throw new Error('인식 영역이 너무 많습니다. 페이지를 나누어 분석해 주세요.');
    const source=document.getElementById('ocr-table-worker-source')?.textContent;
    if(!source||typeof Worker!=='function')throw new Error('표 분석 작업을 준비하지 못했습니다. 표 영역을 직접 지정할 수 있습니다.');
    let chars=0;
    const tokens=words.map(word=>{const text=String(word.text??'');chars+=text.length;if(chars>MAX_CHARS)throw new Error('이 페이지의 인식 텍스트가 너무 큽니다. 페이지를 나누어 주세요.');return {text,box:word.box,separator:word.separator,confidence:word.confidence,uncertain:word.uncertain,corrected:word.corrected};});
    const start=performance.now(),scale=Math.min(1,MAX_EDGE/Math.max(canvas.width,canvas.height));
    const input=document.createElement('canvas');input.width=Math.max(1,Math.round(canvas.width*scale));input.height=Math.max(1,Math.round(canvas.height*scale));
    let pixels;
    try{const context=input.getContext('2d',{alpha:false,willReadFrequently:true});context.fillStyle='#fff';context.fillRect(0,0,input.width,input.height);context.drawImage(canvas,0,0,input.width,input.height);pixels=context.getImageData(0,0,input.width,input.height);}finally{input.width=input.height=0;}
    signal?.throwIfAborted();
    const boot='\nself.onmessage=({data:m})=>{try{const result=PDFOCRTables.detect({data:new Uint8ClampedArray(m.pixels),width:m.width,height:m.height},{words:m.words,region:m.region});self.postMessage({result});}catch(e){self.postMessage({error:e.message||String(e)});}};';
    return new Promise((resolve,reject)=>{
      let worker,url,timer,finished=false;
      function done(error,result){if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();if(url)URL.revokeObjectURL(url);running=null;if(error)reject(error);else resolve({...result,metrics:{...result.metrics,totalMs:performance.now()-start,rasterPixels:pixels.width*pixels.height,rasterBytes:pixels.width*pixels.height*4}});}
      const abort=()=>done(signal.reason||cancelled());
      running={cancel:()=>done(cancelled())};
      try{
        url=URL.createObjectURL(new Blob([source,boot],{type:'application/javascript'}));worker=new Worker(url);
        worker.onmessage=({data})=>data.error?done(new Error(data.error)):done(null,data.result);
        worker.onerror=event=>{event.preventDefault?.();done(new Error('표 분석을 완료하지 못했습니다. 표 영역을 직접 지정해 주세요.'));};
        worker.onmessageerror=()=>done(new Error('표 분석 결과를 읽지 못했습니다. 다시 시도해 주세요.'));
        signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>done(new Error('표 분석 시간이 초과됐습니다. 표 영역을 더 작게 지정해 주세요.')),10000);
        if(signal?.aborted){abort();return;}
        worker.postMessage({pixels:pixels.data.buffer,width:pixels.width,height:pixels.height,words:tokens,region},[pixels.data.buffer]);
      }catch(error){done(error);}
    });
  }
  // A dialog owns this reader. Reuse a loaded local model while correcting cells,
  // then release it when the dialog closes. Abort destroys a stuck session.
  function createCellReader(createSession){
    let session=null,sessionKey='',sessionAbort=null,busy=false,closed=false,activeStop=null;
    const release=async()=>{const previous=session;session=null;sessionKey='';sessionAbort?.abort();sessionAbort=null;await Promise.resolve(previous?.close()).catch(()=>{});};
    async function recognizeRegion(record,box,{signal,canvas}={}){
      signal?.throwIfAborted();if(closed)throw cancelled();if(busy)throw new Error('현재 셀 인식이 끝난 뒤 다시 시도해 주세요.');
      if(!validBox(box))throw new Error('다시 인식할 셀의 위치가 올바르지 않습니다.');checkCanvas(canvas);
      const x=Math.floor(box[0]*canvas.width),y=Math.floor(box[1]*canvas.height),right=Math.ceil(box[2]*canvas.width),bottom=Math.ceil(box[3]*canvas.height),width=right-x,height=bottom-y;
      const scale=Math.min(1,2367/Math.max(width,height),Math.sqrt(4000000/(width*height)));
      const crop=document.createElement('canvas');crop.width=Math.max(1,Math.round(width*scale));crop.height=Math.max(1,Math.round(height*scale));
      const context=crop.getContext('2d',{alpha:false});context.fillStyle='#fff';context.fillRect(0,0,crop.width,crop.height);context.drawImage(canvas,x,y,width,height,0,0,crop.width,crop.height);
      busy=true;let timer,onAbort;
      try{
        const key=(record.source==='paddle-v5'?'paddle-v5':'tesseract')+':'+(record.language||'kor+eng');
        if(sessionKey!==key)await release();
        signal?.throwIfAborted();if(closed)throw cancelled();
        const stop=new Promise((_,reject)=>{onAbort=()=>{sessionAbort?.abort();reject(signal?.reason||cancelled());};activeStop=onAbort;signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{sessionAbort?.abort();reject(new Error('셀 인식 시간이 초과됐습니다. 원문을 보며 직접 수정할 수 있습니다.'));},90000);});
        const work=(async()=>{
          if(!session){const controller=new AbortController();sessionAbort=controller;const created=await createSession(record,controller.signal);if(closed||controller.signal.aborted){await created.close();throw cancelled();}session=created;sessionKey=key;}
          signal?.throwIfAborted();const controller=sessionAbort,result=await session.recognize(crop);signal?.throwIfAborted();if(closed||controller.signal.aborted)throw cancelled();
          if(typeof result?.text!=='string')throw new Error('셀 인식 결과를 확인하지 못했습니다.');
          return {text:result.text,source:key.split(':')[0],confidence:result.confidence};
        })();
        if(signal?.aborted)onAbort();return await Promise.race([work,stop]);
      }catch(error){await release();throw error;}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);activeStop=null;crop.width=crop.height=0;busy=false;}
    }
    return {recognizeRegion,async close(){closed=true;activeStop?.();await release();}};
  }
  globalThis.PDFOCRTableAnalysis=Object.freeze({analyze,createCellReader,validBox,limits:Object.freeze({maxEdge:MAX_EDGE,maxWords:MAX_WORDS,maxChars:MAX_CHARS})});
})();
