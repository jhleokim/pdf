/** Development-only packager. The generated HTML needs no server or installation.
 * This owns no production source: main.mjs is read and adapted in memory at build time.
 * 24 MiB input chunks become <=32 MiB Base64 script blocks. No giant JS string is made.
 */
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,stat,mkdir,rename} from 'node:fs/promises';
import {dirname,resolve,relative,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {build} from './bundle-tools/node_modules/esbuild/lib/main.js';

export const ROOT=dirname(fileURLToPath(import.meta.url));
const RAW_CHUNK_BYTES=24*1024*1024;
const MODEL_DIR='models/paddle-vl15-community/';
const ORT_DIR='node_modules/onnxruntime-web/dist/';
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const escapeScript=source=>source.replace(/<\/script/gi,'<\\/script');

export async function collectStandaloneAssets(){
  const routes=[
    MODEL_DIR+'onnx/embedding.onnx',MODEL_DIR+'onnx/embedding.onnx.data',
    MODEL_DIR+'onnx/vision_encoder_q4.onnx',MODEL_DIR+'onnx/decoder_q4.onnx',
    MODEL_DIR+'tokenizer.json',MODEL_DIR+'tokenizer_config.json',
    MODEL_DIR+'config.json',MODEL_DIR+'processor_config.json',MODEL_DIR+'chat_template.jinja',MODEL_DIR+'README.md',
    // ORT 1.29 ort.webgpu.min.mjs selects asyncify, not the separate JSEP build.
    ORT_DIR+'ort-wasm-simd-threaded.asyncify.mjs',ORT_DIR+'ort-wasm-simd-threaded.asyncify.wasm',
    'fixtures/01-mixed-paragraph.png','fixtures/02-expense-receipt.png','fixtures/03-two-columns-table.png',
    'fixtures/truth.json','community-model-source.json',
    'node_modules/onnxruntime-web/README.md',
    'node_modules/@huggingface/transformers/LICENSE',
    'node_modules/@huggingface/tokenizers/LICENSE','node_modules/@huggingface/jinja/LICENSE',
    'bundle-tools/licenses/NOTICE.txt','bundle-tools/licenses/onnxruntime-1.29.0-LICENSE.txt',
    'bundle-tools/licenses/onnxruntime-1.29.0-ThirdPartyNotices.txt','bundle-tools/licenses/PaddleOCR-Apache-2.0-LICENSE.txt',
  ];
  return Promise.all(routes.map(async(path,index)=>{
    const file=resolve(ROOT,path),details=await stat(file);
    if(!details.isFile()||!details.size)throw Error('Missing/empty standalone asset: '+path);
    return {id:'pa'+index,path,file,size:details.size,mime:path.endsWith('.mjs')?'text/javascript':path.endsWith('.png')?'image/png':path.endsWith('.json')?'application/json':path.endsWith('.wasm')?'application/wasm':'application/octet-stream'};
  }));
}

/** The same loader can be injected before the experimental PDF Studio engine bundle.
 * The Base64 DOM is removed after decoding, while Uint8Array results remain cached.
 * Closing and recreating PDF Studio OCR sessions therefore does not lose model data.
 * Small URL assets (WASM glue, WASM, fixture PNG) use cached Blob URLs.
 */
export function standaloneLoaderSource(manifest){
  return `(()=>{'use strict';
const manifest=${json(manifest)}, assets=new Map(manifest.assets.map(a=>[a.path,a])), urls=new Map(), cache=new Map(), consumed=new Set(), pending=new Map();
const freshFetch=globalThis.fetch.bind(globalThis), status=document.getElementById('standaloneStatus');
const update=text=>{if(status)status.textContent=text};
// Defence in depth: CSP also disallows HTTP/HTTPS and relative file requests.
globalThis.fetch=(resource,options)=>{const value=typeof resource==='string'?resource:resource instanceof URL?resource.href:resource.url;let url;try{url=new URL(value,location.href)}catch{return Promise.reject(Error('Invalid packaged asset URL'))}if(!['blob:','data:'].includes(url.protocol))return Promise.reject(Error('Standalone package blocked an external request: '+url.protocol));return freshFetch(resource,options)};
function canonical(path){path=String(path).replace(/^\\.\\//,'');if(path.startsWith('onnx/')||['tokenizer.json','tokenizer_config.json','config.json','processor_config.json','chat_template.jinja'].includes(path))path='${MODEL_DIR}'+path;return path;}
function decodeBase64(text){if(typeof Uint8Array.fromBase64==='function')return Uint8Array.fromBase64(text);const binary=atob(text),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
async function decodeAsset(path,mode){
 const item=assets.get(path);if(!item)throw Error('File is not embedded in this package: '+path);
 if(consumed.has(path))throw Error('This embedded model was already read. Close and reopen this HTML before reinitializing the engine: '+path);
 const bytes=mode==='bytes'||mode==='json'?new Uint8Array(item.size):null,parts=[];let offset=0;
 // Mark before the first await: partial decode cannot accidentally be reused.
 consumed.add(path);
 for(let i=0;i<item.chunks;i++){
  const element=document.getElementById(item.id+'-'+i);if(!element)throw Error('Embedded data block is missing: '+path+' #'+i);
  const decoded=decodeBase64(element.textContent);element.textContent='';element.remove();
  if(bytes)bytes.set(decoded,offset);else parts.push(decoded);offset+=decoded.length;
  update('내장 파일 읽는 중 · '+path.split('/').pop()+' · '+Math.round(offset/item.size*100)+'%');
  await new Promise(resolve=>setTimeout(resolve,0));
 }
 if(offset!==item.size)throw Error('Embedded asset byte length mismatch: '+path);
 if(mode==='bytes'||mode==='json'){cache.set(path,bytes);return mode==='json'?JSON.parse(new TextDecoder().decode(bytes)):bytes;}
 const url=URL.createObjectURL(new Blob(parts,{type:item.mime}));urls.set(path,url);return url;
}
async function loadAsset(input,mode='bytes'){
 if(!['bytes','url','json'].includes(mode))throw Error('Unsupported embedded asset mode: '+mode);
 const path=canonical(input);if(mode==='url'&&urls.has(path))return urls.get(path);
 if(urls.has(path)&&!cache.has(path)){const response=await freshFetch(urls.get(path));cache.set(path,new Uint8Array(await response.arrayBuffer()));}
 if(cache.has(path)){const bytes=cache.get(path);if(mode==='bytes')return bytes;if(mode==='json')return JSON.parse(new TextDecoder().decode(bytes));const url=URL.createObjectURL(new Blob([bytes],{type:assets.get(path).mime}));urls.set(path,url);return url;}
 const key=mode+':'+path;if(pending.has(key))return pending.get(key);
 const promise=decodeAsset(path,mode);pending.set(key,promise);try{return await promise}finally{pending.delete(key)};
}
let ortConfig;
async function configureORT(ort){
 if(!ortConfig)ortConfig=(async()=>{
  const mjs=await loadAsset('${ORT_DIR}ort-wasm-simd-threaded.asyncify.mjs','url');
  const wasm=await loadAsset('${ORT_DIR}ort-wasm-simd-threaded.asyncify.wasm','url');
  return {mjs,wasm};})();
 ort.env.wasm.wasmPaths=await ortConfig;ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
 return ort.env.wasm.wasmPaths;
}
const api={manifest,loadAsset,configureORT,customImage:null};globalThis.PaddleStandalone=api;
const input=document.getElementById('standaloneFile'),clear=document.getElementById('standaloneClear');
function clearImage(){if(api.customImage)URL.revokeObjectURL(api.customImage.url);api.customImage=null;if(input)input.value='';const fixture=document.getElementById('fixture');if(fixture)fixture.disabled=false;}
if(input)input.addEventListener('change',()=>{const file=input.files?.[0];if(api.customImage)URL.revokeObjectURL(api.customImage.url);api.customImage=null;const fixture=document.getElementById('fixture');if(fixture)fixture.disabled=false;if(!file)return;if(!file.type.startsWith('image/')){input.value='';update('PNG 또는 JPEG 등 이미지 파일 한 개를 선택해 주세요.');return}api.customImage={name:file.name,url:URL.createObjectURL(file)};if(fixture)fixture.disabled=true;update('시험 이미지: '+file.name+' · 외부 전송 없음');});
if(clear)clear.addEventListener('click',clearImage);
if(input){const recognize=document.getElementById('recognize');if(recognize)new MutationObserver(()=>{const busy=!document.getElementById('cancel')?.disabled;input.disabled=busy;if(clear)clear.disabled=busy;}).observe(recognize,{attributes:true,attributeFilter:['disabled']});}
window.addEventListener('pagehide',()=>{for(const url of urls.values())URL.revokeObjectURL(url);if(api.customImage)URL.revokeObjectURL(api.customImage.url)});
update('단일 HTML 준비 완료 · 내장 모델 '+(manifest.modelBytes/1024/1024).toFixed(0)+' MiB · 외부 통신 차단');
})();`;
}

/** Strict anchors intentionally stop a build if the evolving harness no longer matches. */
export function adaptHarness(source){
  function replace(before,after){const count=source.split(before).length-1;if(count!==1)throw Error('Harness adapter expected one source anchor, got '+count+': '+before.slice(0,100));source=source.replace(before,after);}
  replace("ort.env.wasm.wasmPaths=new URL('./node_modules/onnxruntime-web/dist/',location.href).href;","await globalThis.PaddleStandalone.configureORT(ort);\nconst loadAsset=(path,mode)=>globalThis.PaddleStandalone.loadAsset(path,mode);");
  replace("data:new URL('./models/'+folder+'/onnx/embedding.onnx.data',location.href).href","data:await loadAsset('./models/'+folder+'/onnx/embedding.onnx.data')");
  replace("ort.InferenceSession.create('./models/'+folder+'/onnx/'+filename,","ort.InferenceSession.create(await loadAsset('./models/'+folder+'/onnx/'+filename),");
  replace("const tokenizerFiles=await Promise.all(['tokenizer.json','tokenizer_config.json'].map(async file=>{const response=await fetch('./models/'+folder+'/'+file);if(!response.ok)throw Error('Missing tokenizer file: '+file);return response.json()}));","const tokenizerFiles=await Promise.all(['tokenizer.json','tokenizer_config.json'].map(file=>loadAsset('./models/'+folder+'/'+file,'json')));");
  replace("image.src='./fixtures/'+run.id+'.png';","image.src=globalThis.PaddleStandalone.customImage?.url||await loadAsset('./fixtures/'+run.id+'.png','url');if(globalThis.PaddleStandalone.customImage)run.id=globalThis.PaddleStandalone.customImage.name;");
  replace("conversion=$('conversion').value;","conversion='community';");
  return source;
}

export async function bundleBrowser({source,entry,resolveDir=ROOT}={}){
  const ortPath=resolve(ROOT,ORT_DIR+'ort.webgpu.min.mjs');
  const result=await build({...(source!==undefined?{stdin:{contents:source,resolveDir,sourcefile:'standalone-entry.mjs',loader:'js'}}:{entryPoints:[resolve(entry)]}),
    bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline',metafile:true,
    plugins:[{name:'one-pinned-ort',setup(builder){builder.onResolve({filter:/^onnxruntime-(?:web\/webgpu|common)$/},()=>({path:ortPath}));}}]});
  const output=result.outputFiles[0].text;
  const external=Object.values(result.metafile.outputs).flatMap(value=>value.imports).filter(value=>value.external);
  if(external.length)throw Error('Standalone bundle still has external imports: '+JSON.stringify(external));
  return {code:output,metafile:result.metafile};
}

function standaloneHarnessHTML(source){
  source=source.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i,'');
  source=source.replace(/<script type="importmap">[\s\S]*?<\/script>/i,'').replace(/<script type="module" src="\.\/main\.mjs"><\/script>/i,'');
  source=source.replace(/<title>[\s\S]*?<\/title>/,'<title>PaddleOCR-VL-1.5 단일 HTML 실험판</title>');
  source=source.replace(/<h1>[\s\S]*?<\/h1>/,'<h1>PaddleOCR-VL-1.5 · 단일 HTML 실험판</h1>');
  source=source.replace(/<select id="conversion">[\s\S]*?<\/select>/,'<select id="conversion"><option value="community">onnx-community · 내장 Q4 변환본</option></select>');
  source=source.replace(/<option value="112896">[\s\S]*?<\/option>/,'');
  source=source.replace('<button id="probe">','<p><strong>OCR 엔진 시험 도구입니다. PDF Studio 전체 편집기나 운영 배포본이 아닙니다.</strong> 파일을 직접 열어 사용하며, HTTP·CDN 요청을 차단합니다. WebGPU 지원 브라우저와 충분한 메모리가 필요합니다. 초기화 중 오류가 나면 HTML을 닫고 다시 열어 주세요.</p><p id="standaloneStatus" role="status">내장 파일 읽는 중…</p><p><label>내 이미지 한 개 <input id="standaloneFile" type="file" accept="image/png,image/jpeg,image/webp,image/bmp"></label><button id="standaloneClear">예제로 돌아가기</button></p><button id="probe">');
  return source;
}

/** Reusable packager: html is the UI shell; runtimeCode is already bundled ESM.
 * Assets and UI strings remain bounded; model bytes are streamed directly to disk.
 */
export async function writeStandalone({html,runtimeCode,outfile,assets,metadata={}}){
  assets??=await collectStandaloneAssets();outfile=resolve(outfile);await mkdir(dirname(outfile),{recursive:true});
  const manifest={version:1,createdAt:new Date().toISOString(),model:'PaddleOCR-VL-1.5',conversion:'onnx-community/PaddleOCR-VL-1.5-ONNX',revision:'ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4',...metadata,
    modelBytes:assets.filter(a=>a.path.startsWith(MODEL_DIR+'onnx/')).reduce((sum,a)=>sum+a.size,0),
    rawBytes:assets.reduce((sum,a)=>sum+a.size,0),chunkBase64Bytes:RAW_CHUNK_BYTES/3*4,
    assets:assets.map(({file,...asset})=>({...asset,chunks:Math.ceil(asset.size/RAW_CHUNK_BYTES)}))};
  const temp=outfile+'.partial',stream=createWriteStream(temp);let bytesWritten=0;
  const write=async value=>{bytesWritten+=Buffer.byteLength(value);if(!stream.write(value))await once(stream,'drain');};
  try{
    // Even file:// cannot contact a cloud OCR endpoint under this policy.
    // Emscripten's embind glue uses Function constructors as well as WebAssembly.
    const csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' \'wasm-unsafe-eval\' blob:; style-src \'unsafe-inline\'; img-src blob: data:; font-src blob: data:; frame-src blob: data:; connect-src blob: data:; worker-src blob:; base-uri \'none\'; form-action \'none\'">';
    html=html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/gi,'');
    html=html.replace(/(<meta charset=[^>]*>)/i,'$1'+csp).replace(/<\/html>\s*$/i,'');
    await write(html+'\n');
    // Retain readable original license text in addition to the binary asset list.
    // Hidden details match the application's existing bundled font notices.
    const esc=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const noticeAssets=assets.filter(asset=>/LICENSE|ThirdPartyNotices|\/NOTICE\.txt$/.test(asset.path)||asset.path===MODEL_DIR+'README.md');
    await write('<details hidden id="paddle-bundled-licenses"><summary>Paddle experiment third-party licenses and notices</summary>\n');
    for(const asset of noticeAssets)await write('<h3>'+esc(asset.path)+'</h3><pre>'+esc(await readFile(asset.file,'utf8'))+'</pre>\n');
    await write('</details>\n');
    for(let a=0;a<assets.length;a++){
      const asset=assets[a],hash=createHash('sha256');let chunk=0,read=0;
      console.log('Embedding '+asset.path+' ('+(asset.size/1024/1024).toFixed(1)+' MiB)');
      for await(const buffer of createReadStream(asset.file,{highWaterMark:RAW_CHUNK_BYTES})){
        hash.update(buffer);read+=buffer.length;
        await write('<script type="application/octet-stream" id="'+asset.id+'-'+chunk+'">');
        await write(buffer.toString('base64'));await write('</script>\n');chunk++;
      }
      if(read!==asset.size||chunk!==manifest.assets[a].chunks)throw Error('Asset changed during packaging: '+asset.path);
      manifest.assets[a].sha256=hash.digest('hex');
    }
    await write('<script>'+escapeScript(standaloneLoaderSource(manifest))+'</script>\n');
    await write('<script type="module">'+escapeScript(runtimeCode)+'</script>\n</html>\n');
    stream.end();await once(stream,'finish');await rename(temp,outfile);
  }catch(error){stream.destroy();throw error;}
  console.log('Created '+outfile+' ('+(bytesWritten/1024/1024).toFixed(1)+' MiB)');
  return {outfile,bytesWritten,manifest};
}

export async function buildHarnessStandalone({outfile=resolve(ROOT,'paddle-vl15-standalone-experiment.html')}={}){
  const [main,index,assets]=await Promise.all([readFile(resolve(ROOT,'main.mjs'),'utf8'),readFile(resolve(ROOT,'index.html'),'utf8'),collectStandaloneAssets()]);
  const bundled=await bundleBrowser({source:adaptHarness(main)});
  return writeStandalone({html:standaloneHarnessHTML(index),runtimeCode:bundled.code,outfile,assets,metadata:{purpose:'Standalone OCR engine proof of concept; not the full PDF Studio application',sourceHash:createHash('sha256').update(main).digest('hex')}});
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const output=process.argv[2]?resolve(process.argv[2]):undefined;
  await buildHarnessStandalone({outfile:output});
}
