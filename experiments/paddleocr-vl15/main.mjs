import * as ort from './node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs';

const $=id=>document.getElementById(id);
const report={model:'PaddleOCR-VL-1.5',conversion:'lbm364dl/PaddleOCR-VL-1.5-ONNX',revision:'213c67b21d0a26d4a5eb364fb20fab55cee2dbff',events:[],runs:[]};
let sessions={},tokenizer,cancelled=false,conversion='lbm';
const show=()=>{$('result').textContent=JSON.stringify(report,null,2)};
const log=message=>{report.events.push({message,time:new Date().toISOString()});$('status').textContent=message;show()};
const check=()=>{if(cancelled)throw new DOMException('취소했습니다.','AbortError')};
const dispose=tensor=>{try{tensor?.dispose()}catch{}};
const tensorData=async tensor=>tensor.location==='gpu-buffer'?await tensor.getData():tensor.data;
ort.env.wasm.wasmPaths=new URL('./node_modules/onnxruntime-web/dist/',location.href).href;
ort.env.wasm.numThreads=1;ort.env.logLevel='warning';

$('probe').onclick=async()=>{
  try{
    const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
    report.browser={secureContext:isSecureContext,webgpu:!!navigator.gpu,adapter:!!adapter,hardwareConcurrency:navigator.hardwareConcurrency,features:adapter?[...adapter.features]:[],limits:adapter?Object.fromEntries(['maxBufferSize','maxStorageBufferBindingSize','maxComputeWorkgroupStorageSize'].map(k=>[k,adapter.limits[k]])):null};
    $('load').disabled=false;log('브라우저 실행 환경 확인 완료');
  }catch(error){report.error=String(error.stack||error);log('브라우저 환경 확인 실패')}
};

$('load').onclick=async()=>{
  $('load').disabled=true;delete report.error;
  try{
    conversion=$('conversion').value;
    const alternate=conversion==='community',folder=alternate?'paddle-vl15-community':'paddle-vl15';
    report.conversion=alternate?'onnx-community/PaddleOCR-VL-1.5-ONNX':'lbm364dl/PaddleOCR-VL-1.5-ONNX';
    report.revision=alternate?'ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4':'213c67b21d0a26d4a5eb364fb20fab55cee2dbff';
    report.ortVersion=ort.env.versions;report.sessions=[];
    for(const previous of Object.values(sessions))await previous.release();sessions={};
    for(const name of ['embed_tokens','vision_encoder','decoder_model_merged']){
      log(name+' 불러오는 중');const start=performance.now();
      const gpuCache=name==='decoder_model_merged'&&report.browser.adapter?{preferredOutputLocation:Object.fromEntries(Array.from({length:18},(_,i)=>['key','value'].map(kind=>['present.'+i+'.'+kind,'gpu-buffer'])).flat())}:{};
      const filename=alternate?{embed_tokens:'embedding.onnx',vision_encoder:'vision_encoder_q4.onnx',decoder_model_merged:'decoder_q4.onnx'}[name]:name+'.onnx';
      const external=alternate&&name==='embed_tokens'?{externalData:[{path:'embedding.onnx.data',data:new URL('./models/'+folder+'/onnx/embedding.onnx.data',location.href).href}]}:{};
      const session=await ort.InferenceSession.create('./models/'+folder+'/onnx/'+filename,{executionProviders:report.browser.adapter?['webgpu']:['wasm'],graphOptimizationLevel:'all',...gpuCache,...external});
      sessions[name]=session;report.sessions.push({name,elapsedMs:performance.now()-start,inputs:session.inputMetadata,outputs:session.outputMetadata});show();
    }
    const {LlamaTokenizer}=await import('./node_modules/@huggingface/transformers/dist/transformers.web.js');
    // Read the two known, pinned files directly. The automatic v4 model registry
    // otherwise attempts remote discovery even though every asset is local.
    const tokenizerFiles=await Promise.all(['tokenizer.json','tokenizer_config.json'].map(async file=>{const response=await fetch('./models/'+folder+'/'+file);if(!response.ok)throw Error('Missing tokenizer file: '+file);return response.json()}));
    tokenizer=new LlamaTokenizer(...tokenizerFiles);
    report.tokenizer={type:tokenizer.constructor.name,test:tokenizer.encode('OCR:',{add_special_tokens:false})};
    for(const id of ['recognize','spotting'])$(id).disabled=false;log('PaddleOCR-VL-1.5 브라우저 엔진 준비 완료');
  }catch(error){report.error=String(error.stack||error);log('ONNX 브라우저 초기화 실패');$('load').disabled=false}
};

async function recognize(task){
  cancelled=false;for(const id of ['recognize','spotting','load'])$(id).disabled=true;$('cancel').disabled=false;
  const run={id:$('fixture').value,engine:'paddleocr-vl-1.5-'+conversion+'-q4-'+(report.browser.adapter?'webgpu':'wasm'),conversion:report.conversion,revision:report.revision,task,output_format:'plain',max_pixels:Number($('pixels').value),max_tokens:Number($('tokens').value),stages:[],status:'running'};
  report.runs.push(run);const started=performance.now();let past={},embedResult;
  try{
    const {preprocessCanvas,buildPrompt,generationPositionIds,parseSpotting}=await import('./preprocess.mjs');
    const image=new Image();image.src='./fixtures/'+run.id+'.png';await image.decode();check();
    const canvas=$('preview');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
    log('이미지 전처리');let stage=performance.now();
    let inferenceCanvas=canvas;
    if(run.max_pixels===112896){inferenceCanvas=document.createElement('canvas');inferenceCanvas.width=336;inferenceCanvas.height=336;inferenceCanvas.getContext('2d').drawImage(canvas,0,0,336,336);run.input_transform='stretched 336x336 for fixed-export diagnosis, not a quality benchmark';}
    const pixels=preprocessCanvas(inferenceCanvas,{task,maxPixels:run.max_pixels,spottingUpscale:task==='spotting'&&run.max_pixels!==112896});
    run.preprocess={grid:pixels.grid,pixelDims:pixels.pixelDims,imageTokenCount:pixels.imageTokenCount,resizedWidth:pixels.resizedWidth,resizedHeight:pixels.resizedHeight};
    run.stages.push({name:'preprocess',ms:performance.now()-stage});
    const prompt=await buildPrompt(tokenizer,pixels.grid,{task});
    run.prompt={length:prompt.inputIds.length,imageTokens:prompt.imageTokenCount,ropeDelta:prompt.ropeDelta};check();
    log('이미지 분석');stage=performance.now();
    const pixelTensor=new ort.Tensor('float32',pixels.pixelValues,pixels.pixelDims),gridTensor=new ort.Tensor('int64',pixels.imageGridThw,[1,3]);
    let vision;
    try{vision=await sessions.vision_encoder.run({pixel_values:pixelTensor,image_grid_thw:gridTensor})}finally{dispose(pixelTensor);dispose(gridTensor)}
    run.stages.push({name:'vision',ms:performance.now()-stage});check();
    const visual=vision[sessions.vision_encoder.outputNames[0]],visualData=await tensorData(visual);
    if(visual.dims[0]!==pixels.imageTokenCount||visual.dims[1]!==1024)throw new Error('이미지 토큰 수 불일치: '+JSON.stringify(visual.dims));
    stage=performance.now();const initialIds=new ort.Tensor('int64',prompt.inputIds,prompt.inputDims);
    try{embedResult=await sessions.embed_tokens.run({input_ids:initialIds})}finally{dispose(initialIds)}
    const embedding=embedResult[sessions.embed_tokens.outputNames[0]],embeddingData=await tensorData(embedding);let imageIndex=0;
    for(let i=0;i<prompt.inputIds.length;i++)if(Number(prompt.inputIds[i])===100295){embeddingData.set(visualData.subarray(imageIndex*1024,(imageIndex+1)*1024),i*1024);imageIndex++}
    dispose(visual);if(imageIndex!==pixels.imageTokenCount)throw new Error('이미지 프롬프트 수 불일치');
    let inputsEmbeds=new ort.Tensor('float32',embeddingData.slice(),[1,prompt.inputIds.length,1024]);dispose(embedding);embedResult=null;
    run.stages.push({name:'embedding',ms:performance.now()-stage});
    for(let i=0;i<18;i++)for(const kind of ['key','value'])past['past_key_values.'+i+'.'+kind]=new ort.Tensor('float32',new Float32Array(0),[1,2,0,128]);
    let inputLength=prompt.inputIds.length,totalCachedTokens=0;const generated=[];let stopped='max_tokens';
    for(let step=0;step<run.max_tokens;step++){
      check();const fullLength=totalCachedTokens+inputLength;
      const mask=new ort.Tensor('int64',new BigInt64Array(fullLength).fill(1n),[1,fullLength]);
      const positions=new ort.Tensor('int64',step===0?prompt.positionIds:generationPositionIds(totalCachedTokens,inputLength,prompt.ropeDelta),[3,1,inputLength]);
      const branch=new ort.Tensor('bool',new Uint8Array([step>0?1:0]),[1]);
      if(step===0)log('문자 인식 · 첫 토큰 생성');stage=performance.now();
      let output;
      const feeds={inputs_embeds:inputsEmbeds,attention_mask:mask,...past};
      if(sessions.decoder_model_merged.inputNames.includes('position_ids'))feeds.position_ids=positions;
      if(sessions.decoder_model_merged.inputNames.includes('use_cache_branch'))feeds.use_cache_branch=branch;
      try{output=await sessions.decoder_model_merged.run(feeds)}
      finally{dispose(mask);dispose(positions);dispose(branch);dispose(inputsEmbeds)}
      const tokenMs=performance.now()-stage;
      if(step===0)run.stages.push({name:'prefill',ms:tokenMs});
      for(const tensor of Object.values(past))dispose(tensor);past={};
      for(let i=0;i<18;i++)for(const kind of ['key','value'])past['past_key_values.'+i+'.'+kind]=output['present.'+i+'.'+kind];
      totalCachedTokens=fullLength;
      const logits=await tensorData(output.logits),vocab=103424,offset=logits.length-vocab;let best=0,bestValue=-Infinity;
      for(let i=0;i<vocab;i++)if(logits[offset+i]>bestValue){bestValue=logits[offset+i];best=i}
      dispose(output.logits);
      if(!Number.isFinite(bestValue))throw new Error('출력 로짓에 유효한 값이 없습니다.');
      if(best===2){stopped='eos';break}
      generated.push(best);run.generated_tokens=generated.length;
      if(step===0||step%16===0){run.raw_text=tokenizer.decode(generated,{skip_special_tokens:false});$('text').textContent=run.raw_text;log('문자 인식 · '+generated.length+'개 토큰')}
      if(generated.length>=80&&new Set(generated.slice(-64)).size===1){stopped='repetition_detected';break}
      const idTensor=new ort.Tensor('int64',BigInt64Array.of(BigInt(best)),[1,1]);
      try{embedResult=await sessions.embed_tokens.run({input_ids:idTensor})}finally{dispose(idTensor)}
      inputsEmbeds=embedResult[sessions.embed_tokens.outputNames[0]];embedResult=null;inputLength=1;
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    dispose(inputsEmbeds);
    run.raw_text=tokenizer.decode(generated,{skip_special_tokens:false});run.stop_reason=stopped;
    run.text=task==='spotting'?parseSpotting(run.raw_text).text:tokenizer.decode(generated,{skip_special_tokens:true});
    if(task==='spotting'){const parsed=parseSpotting(run.raw_text);run.words=parsed.words;run.warnings=parsed.warnings;const ctx=canvas.getContext('2d');ctx.strokeStyle='#e04a39';ctx.lineWidth=2;for(const word of parsed.words){const [l,t,r,b]=word.box;ctx.strokeRect(l*canvas.width,t*canvas.height,(r-l)*canvas.width,(b-t)*canvas.height)}}
    run.status=stopped==='eos'?'complete':'incomplete';run.elapsed_ms=performance.now()-started;$('text').textContent=run.text;log(run.status==='complete'?'시험 인식 완료':'시험 인식 종료 · '+stopped);
  }catch(error){run.status=error.name==='AbortError'?'cancelled':'error';run.error=String(error.stack||error);run.elapsed_ms=performance.now()-started;log('시험 인식 '+(run.status==='cancelled'?'취소':'실패'))}
  finally{for(const tensor of Object.values(past))dispose(tensor);if(embedResult)for(const tensor of Object.values(embedResult))dispose(tensor);$('cancel').disabled=true;for(const id of ['recognize','spotting'])$(id).disabled=!tokenizer;show()}
}
$('recognize').onclick=()=>recognize('ocr');$('spotting').onclick=()=>recognize('spotting');$('cancel').onclick=()=>{cancelled=true;log('취소 요청 · 진행 중 연산 종료 후 중단')};
