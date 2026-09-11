/* Experimental browser-only adapter. Pinned community conversion, not the full
 * official PaddleOCR document-layout pipeline. Documents stay in this browser. */
import * as ort from 'onnxruntime-web/webgpu';
import {LlamaTokenizer} from '@huggingface/transformers';
import {preprocessCanvas,buildPrompt,parseSpotting} from './preprocess.mjs';

export const PADDLE_IDENTITY='PaddleOCR-VL-1.5/community-Q4/ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4/browser-v1';
const dispose=t=>{try{t?.dispose()}catch{}};
const data=async t=>t.location==='gpu-buffer'?await t.getData():t.data;
let configuration={};

export async function createPaddleSession({signal,onProgress,assetLoader,configureORT,maxPixels=1003520,maxTokens=1536}={}){
  signal?.throwIfAborted();
  const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)throw Error('Paddle 인식에는 WebGPU를 지원하는 브라우저와 그래픽 장치가 필요합니다.');
  if(adapter.limits.maxStorageBufferBindingSize<512*1024*1024)throw Error('이 장치의 WebGPU 메모리 한도가 Paddle 모델 실행에 부족합니다.');
  if(typeof assetLoader!=='function'||typeof configureORT!=='function')throw Error('Paddle 모델 로더를 준비하지 못했습니다. 페이지를 새로 열어 주세요.');
  await configureORT(ort,signal,onProgress);
  // Use the same high-performance adapter that passed preflight.
  ort.env.webgpu.adapter=adapter;
  const assetSource=assetLoader;
  const emit=(status,detail,progress=0)=>onProgress?.({status,detail,progress});
  const check=()=>{signal?.throwIfAborted();if(closed)throw new DOMException('취소했습니다.','AbortError');};
  const sessions={};let tokenizer,closed=false,active=null;
  const prepared=new Map();
  const assetProgress=m=>{if(m.assetPath&&m.totalModelBytes){prepared.set(m.assetPath,m.loadedBytes);const loaded=[...prepared.values()].reduce((a,b)=>a+b,0);onProgress?.({...m,progress:loaded/m.totalModelBytes,detail:'모델 데이터 '+Math.round(loaded/1048576)+' / '+Math.round(m.totalModelBytes/1048576)+' MB'});}else onProgress?.(m);};
  const load=async path=>{check();const bytes=await assetSource(path,signal,assetProgress);check();return bytes;};
  async function release(){for(const s of Object.values(sessions))await s.release().catch(()=>{});}
  try{
    for(const [key,file,label] of [['embedding','embedding.onnx','문자 모델'],['vision','vision_encoder_q4.onnx','이미지 분석 모델'],['decoder','decoder_q4.onnx','인식 모델']]){
      check();emit('preparing engine',label+' 불러오는 중');
      const options={executionProviders:['webgpu'],graphOptimizationLevel:'all'};
      if(key==='embedding')options.externalData=[{path:'embedding.onnx.data',data:await load('onnx/embedding.onnx.data')}];
      if(key==='decoder')options.preferredOutputLocation=Object.fromEntries(Array.from({length:18},(_,i)=>['key','value'].map(kind=>['present.'+i+'.'+kind,'gpu-buffer'])).flat());
      const modelBytes=await load('onnx/'+file);
      emit('preparing engine',label+' WebGPU 초기화 중');
      sessions[key]=await ort.InferenceSession.create(modelBytes,options);
      check();
    }
    check();emit('preparing engine','토크나이저 준비');
    const configs=await Promise.all(['tokenizer.json','tokenizer_config.json'].map(async name=>JSON.parse(new TextDecoder().decode(await load(name)))));
    tokenizer=new LlamaTokenizer(...configs);check();
  }catch(error){closed=true;await release();throw error;}

  async function recognize(canvas){
    check();const started=performance.now();let past={},inputsEmbeds,visionTensor;
    const tokenIds=[];let stop='max_tokens';
    try{
      emit('recognizing text','페이지 이미지 준비');
      const pixels=preprocessCanvas(canvas,{task:'spotting',maxPixels,signal});
      const prompt=await buildPrompt(tokenizer,pixels.grid,{task:'spotting'});check();
      emit('recognizing text','페이지 이미지 분석');
      const pv=new ort.Tensor('float32',pixels.pixelValues,pixels.pixelDims),grid=new ort.Tensor('int64',pixels.imageGridThw,[1,3]);
      let visual;
      try{visual=await sessions.vision.run({pixel_values:pv,image_grid_thw:grid})}finally{dispose(pv);dispose(grid)}
      visionTensor=visual[sessions.vision.outputNames[0]];check();
      if(visionTensor.dims[0]!==pixels.imageTokenCount||visionTensor.dims[1]!==1024)throw Error('이미지 토큰과 문서 크기가 일치하지 않습니다.');
      const imageData=await data(visionTensor),ids=new ort.Tensor('int64',prompt.inputIds,prompt.inputDims);
      let embedding;
      try{embedding=await sessions.embedding.run({input_ids:ids})}finally{dispose(ids)}
      const raw=embedding[sessions.embedding.outputNames[0]],inputData=(await data(raw)).slice();dispose(raw);
      let index=0;
      for(let i=0;i<prompt.inputIds.length;i++)if(Number(prompt.inputIds[i])===100295){inputData.set(imageData.subarray(index*1024,(index+1)*1024),i*1024);index++;}
      dispose(visionTensor);visionTensor=null;
      if(index!==pixels.imageTokenCount)throw Error('이미지 프롬프트가 맞지 않습니다.');
      inputsEmbeds=new ort.Tensor('float32',inputData,[1,prompt.inputIds.length,1024]);
      for(let i=0;i<18;i++)for(const kind of ['key','value'])past['past_key_values.'+i+'.'+kind]=new ort.Tensor('float32',new Float32Array(0),[1,2,0,128]);
      let cached=0,length=prompt.inputIds.length;
      for(let step=0;step<maxTokens;step++){
        check();const total=cached+length,mask=new ort.Tensor('int64',new BigInt64Array(total).fill(1n),[1,total]);let output;
        try{output=await sessions.decoder.run({inputs_embeds:inputsEmbeds,attention_mask:mask,...past})}finally{dispose(mask);dispose(inputsEmbeds);inputsEmbeds=null;}
        for(const tensor of Object.values(past))dispose(tensor);past={};
        for(let i=0;i<18;i++)for(const kind of ['key','value'])past['past_key_values.'+i+'.'+kind]=output['present.'+i+'.'+kind];
        cached=total;const scores=await data(output.logits),vocab=103424,offset=scores.length-vocab;let best=0,bestValue=-Infinity;
        for(let i=0;i<vocab;i++)if(scores[offset+i]>bestValue){bestValue=scores[offset+i];best=i;}
        dispose(output.logits);if(!Number.isFinite(bestValue))throw Error('인식 결과가 유효하지 않습니다.');
        if(best===2){stop='eos';break;}
        tokenIds.push(best);if(step%16===0)emit('recognizing text',tokenIds.length+'개 토큰 처리');
        if(tokenIds.length>=80&&new Set(tokenIds.slice(-64)).size===1)throw Error('같은 글자가 반복되어 인식을 중단했습니다.');
        const nextId=new ort.Tensor('int64',BigInt64Array.of(BigInt(best)),[1,1]);let next;
        try{next=await sessions.embedding.run({input_ids:nextId})}finally{dispose(nextId)}
        inputsEmbeds=next[sessions.embedding.outputNames[0]];length=1;
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      check();
      if(stop!=='eos')throw Error('Paddle 실험판의 '+maxTokens.toLocaleString('ko-KR')+'토큰 출력 한도에 도달해 이 페이지를 끝까지 읽지 못했습니다. 결과를 완료로 저장하지 않습니다. Tesseract 또는 활성화한 Google Vision을 이용해 주세요.');
      const rawText=tokenizer.decode(tokenIds,{skip_special_tokens:false}),parsed=parseSpotting(rawText);
      if(!parsed.words.length)throw Error('검색용 PDF에 필요한 텍스트 위치를 인식하지 못했습니다.');
      emit('recognizing text','텍스트와 위치 인식 완료',1);
      return {...parsed,rawText,confidence:null,source:'paddle-vl15',model:PADDLE_IDENTITY,granularity:'line',elapsedMs:performance.now()-started,generatedTokens:tokenIds.length,preprocess:{width:pixels.resizedWidth,height:pixels.resizedHeight,maxPixels}};
    }finally{dispose(inputsEmbeds);dispose(visionTensor);for(const tensor of Object.values(past))dispose(tensor);}
  }
  return {
    model:PADDLE_IDENTITY,
    recognize(canvas){if(active)throw Error('이미 인식 중입니다.');active=recognize(canvas).finally(()=>{active=null});return active;},
    async close(){if(closed)return;closed=true;if(active)await active.catch(()=>{});await release();}
  };
}

globalThis.PDFPaddle={model:PADDLE_IDENTITY,configure(options){configuration={...configuration,...options};},session(language,signal,onProgress,layout){return createPaddleSession({...configuration,signal,onProgress});}};
