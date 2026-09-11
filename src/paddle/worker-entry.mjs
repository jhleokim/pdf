import './session.mjs';
import {createPaddleAssets} from './web-assets.mjs';
import manifest from '../../vendor/paddle/assets/ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4/assets.json';
const assets=createPaddleAssets({manifest,baseURL:new URL('./models/'+manifest.revision+'/',import.meta.url).href});
globalThis.PDFPaddle.configure({
  assetLoader:(path,signal,onProgress)=>assets.loadAsset(path,signal,onProgress),
  configureORT:async ort=>{
    const base=new URL('./ort-1.29.0/',import.meta.url);
    ort.env.wasm.wasmPaths={mjs:new URL('ort-wasm-simd-threaded.asyncify.mjs',base).href,wasm:new URL('ort-wasm-simd-threaded.asyncify.wasm',base).href};
    ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
  }
});
let session=null,active=false,currentId=0;
const onProgress=progress=>postMessage({id:currentId,type:'progress',progress});
globalThis.onmessage=async({data})=>{
  if(active)return;active=true;currentId=data.id;
  try{
    if(data.type==='init'){
      if(typeof OffscreenCanvas==='undefined')throw Error('이 브라우저는 Paddle 기기 내 인식을 지원하지 않습니다. Tesseract를 선택해 주세요.');
      session=await globalThis.PDFPaddle.session('kor+eng',new AbortController().signal,onProgress);
      postMessage({id:data.id,type:'result'});
    }else if(data.type==='recognize'&&session){
      const canvas=new OffscreenCanvas(data.width,data.height);
      try{canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.pixels),data.width,data.height),0,0);const result=await session.recognize(canvas);postMessage({id:data.id,type:'result',result});}
      finally{canvas.width=canvas.height=0;}
    }else throw Error('Paddle 모델을 먼저 준비해 주세요.');
  }catch(error){postMessage({id:data.id,type:'error',error:{message:error.message,code:error.code}});}
  finally{active=false;}
};
