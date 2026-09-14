// A sandbox without allow-same-origin reproduces blob:null worker loading.
// No test PDF or browser security override is required.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'dist/PDF-Studio-Standalone-v5.0.html'),'utf8');
let bootstrap=html.match(/<script id="paddle-bootstrap">([\s\S]*?)<\/script>/)?.[1];
if(!bootstrap)throw Error('Missing Paddle bootstrap');
// Unlike file: documents, sandboxed HTTP frames lose WebCrypto. Relay only
// SHA-256 to the secure test parent so real integrity checks still execute.
// OCR, module imports, WASM and model loading remain inside the opaque worker.
const literal=bootstrap.match(/const embedded=({[\s\S]*?});/)[1],embedded=JSON.parse(literal);
const digestShim=`if(!crypto.subtle){let seq=0;const pending=new Map();Object.defineProperty(crypto,'subtle',{value:{digest(algorithm,bytes){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});postMessage({testDigest:id,bytes});});}}});addEventListener('message',e=>{if(e.data.testDigestResult){e.stopImmediatePropagation();const p=pending.get(e.data.testDigestResult);pending.delete(e.data.testDigestResult);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.digest);}});}\n`;
embedded['worker.js'].data=Buffer.from(digestShim+Buffer.from(embedded['worker.js'].data,'base64').toString()).toString('base64');
bootstrap=bootstrap.replace(literal,JSON.stringify(embedded));
const relay=`const nativeWorker=Worker,workers=new Map();let workerSeq=0;Worker=class extends nativeWorker{constructor(url,options){super(url,options);const id=++workerSeq;workers.set(id,this);this.addEventListener('message',e=>{if(e.data.testDigest)parent.postMessage({digestWorker:id,testDigest:e.data.testDigest,bytes:e.data.bytes},'*');});}terminate(){for(const[id,w]of workers)if(w===this)workers.delete(id);super.terminate();}};addEventListener('message',e=>{if(e.source===parent&&e.data.digestWorker)workers.get(e.data.digestWorker)?.postMessage({testDigestResult:e.data.testDigestResult,digest:e.data.digest,error:e.data.error});});`;
const run=`(async()=>{let session;const report=text=>{document.querySelector('output').textContent=text;parent.postMessage({opaqueOCR:text},'*')};try{
 report('Running · origin '+self.origin+' · secure '+isSecureContext);
 const api=await PDFPaddleLoad();session=await api.session('kor',null,p=>report('Running · '+p.detail));
 const c=document.querySelector('canvas');c.width=1000;c.height=300;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.fillStyle='#000';g.font='36px Arial';g.fillText('CONTRACT 1234567890',60,100);g.fillText('TOTAL 150,000',60,180);
 const first=await session.recognize(c);if(!first.text.includes('1234567890')||!first.words.length)throw Error('Unexpected OCR: '+first.text);
 const second=await session.recognize(c);if(second.text!==first.text)throw Error('Second page differs');await session.close();session=null;
 report('PASS · origin '+self.origin+' · two OCR pages · '+first.text);
 }catch(e){report('FAIL · '+e.message+'\\n'+e.stack)}finally{await session?.close()}})();`;
const directory=path.join(__dirname,'fixtures');fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(directory,'opaque-ocr-child.html'),'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="connect-src blob: data:; worker-src blob: data:"><output>Running</output><canvas></canvas><script>'+relay+'</script><script>'+bootstrap+'</script><script>'+run+'</script>');
fs.writeFileSync(path.join(directory,'opaque-ocr.html'),'<!doctype html><meta charset="utf-8"><title>Opaque origin OCR regression</title><pre id="report">Running</pre><iframe sandbox="allow-scripts" src="opaque-ocr-child.html"></iframe><script>addEventListener("message",async e=>{const child=document.querySelector("iframe").contentWindow;if(e.source!==child||e.origin!=="null")return;if(typeof e.data.opaqueOCR==="string")document.querySelector("pre").textContent=e.data.opaqueOCR;if(e.data.testDigest){try{const digest=await crypto.subtle.digest("SHA-256",e.data.bytes);child.postMessage({digestWorker:e.data.digestWorker,testDigestResult:e.data.testDigest,digest},"*",[digest])}catch(error){child.postMessage({digestWorker:e.data.digestWorker,testDigestResult:e.data.testDigest,error:error.message},"*")}}})</script>');
