let engine;
onmessage=async({data})=>{
 try{
  if(data.type==='init'){
   const urls=data.urls||{};importScripts(urls['ort.js']||'ort.js',urls['opencv.js']||'opencv.js',urls['engine.js']||'engine.js');
   ort.env.wasm.wasmPaths={mjs:urls['ort-wasm-simd-threaded.mjs']||new URL('ort-wasm-simd-threaded.mjs',location.href).href,wasm:urls['ort-wasm-simd-threaded.wasm']||new URL('ort-wasm-simd-threaded.wasm',location.href).href};
   engine=await createPPV5({asset:async name=>new Uint8Array(await(await fetch(urls[name]||name)).arrayBuffer()),onProgress:(label,progress)=>postMessage({type:'progress',label,progress})});postMessage({type:'ready'});
  }else if(data.type==='recognize'){
   const canvas=new OffscreenCanvas(data.width,data.height);canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.pixels),data.width,data.height),0,0);
   try{const result=await engine.recognize(canvas,{size:data.size});postMessage({type:'result',result});}finally{canvas.width=canvas.height=0;}
  }
 }catch(e){postMessage({type:'error',message:e.message});}
};
