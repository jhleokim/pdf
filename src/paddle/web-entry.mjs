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
