// Development observation only: every recognition and PDF build uses the real
// app/engine. Results are exposed in visible DOM for the browser test driver.
const panel=document.createElement('details');panel.id='paddleDevQA';
panel.innerHTML='<summary>개발 검증 기록 · 합성 문서 시험용</summary><pre id="paddleDevReport"></pre><details><summary>실제 저장 PDF 바이트</summary><pre id="paddleDevPDF"></pre></details>';
panel.style.cssText='position:relative;margin:24px;padding:12px;background:#fff;color:#222;white-space:pre-wrap;overflow-wrap:anywhere';document.body.append(panel);
const report={events:[],runs:[],downloads:[],errors:[]};
const flush=()=>document.getElementById('paddleDevReport').textContent=JSON.stringify(report,null,2);
const event=(name,details={})=>{report.events.push({name,at:new Date().toISOString(),...details});flush();};
addEventListener('error',e=>{report.errors.push(String(e.message));flush();});
addEventListener('unhandledrejection',e=>{report.errors.push(String(e.reason));flush();});
const download=globalThis.downloadPdf;
globalThis.downloadPdf=(bytes,name)=>{
  report.downloads.push({name,bytes:bytes.byteLength});
  let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
  document.getElementById('paddleDevPDF').textContent=btoa(binary);flush();
  return download(bytes,name);
};
await globalThis.PDFPaddleReady;
const session=globalThis.PDFPaddle.session;
globalThis.PDFPaddle.session=async(...args)=>{
  event('session-start');let engine;
  try{engine=await session(...args);}catch(error){event('session-error',{type:error.name,message:error.message});throw error;}
  event('session-ready');
  return {async close(){await engine.close();event('session-closed');},async recognize(canvas){
    event('recognize-start',{width:canvas.width,height:canvas.height});
    try{const result=await engine.recognize(canvas);report.runs.push(result);event('recognize-complete');return result;}
    catch(error){event('recognize-error',{type:error.name,message:error.message});throw error;}
  }};
};
event('observer-ready');
