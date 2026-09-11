/** PDF Studio + browser Paddle experiment. Production sources are only read.
 * Direct file:// execution is unverified: the available browser tool explicitly
 * blocks that navigation. HTTP development-build tests are separate evidence.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildPDFStudioExperiment,PADDLE_EXPECTED_MODEL} from './build-pdf-studio-experiment.mjs';
import {ROOT,bundleBrowser,collectStandaloneAssets,writeStandalone} from './build-standalone.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function once(source,before,after,label=before){
  const count=source.split(before).length-1;
  if(count!==1)throw Error('Standalone adapter expected one '+label+' anchor; got '+count);
  return source.replace(before,after);
}

/** Remove the developer HTTP transport from an in-memory copy, not root's module.
 * Explicit guards make drift in that module a build error rather than a network fallback.
 */
export function adaptPDFPaddleRuntime(source){
  source=source.replace(/\r\n/g,'\n');
  source=once(source,'export const PADDLE_IDENTITY=','const PADDLE_IDENTITY=','model export');
  source=once(source,'export async function createPaddleSession(','async function createPaddleSession(','session export');
  const start=source.indexOf('async function defaultLoader(path,signal){'),end=source.indexOf('\n}\n',start);
  if(start<0||end<0)throw Error('Standalone adapter cannot locate the developer asset loader');
  const loader=source.slice(start,end+3);
  if(!loader.includes("fetch(new URL('./models/paddle-vl15-community/'+path,import.meta.url),{signal})"))throw Error('Developer asset loader changed; re-review the offline adapter');
  source=source.slice(0,start)+"async function defaultLoader(path){throw Error('Standalone embedded asset loader is unavailable: '+path);}\n"+source.slice(end+3);
  source=once(source,"else{ort.env.wasm.wasmPaths=new URL('./node_modules/onnxruntime-web/dist/',import.meta.url).href;ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;}","else{throw Error('모델이 내장된 PDF Studio 실험 HTML을 열어 주세요.');}",'relative ORT fallback');
  // This package deliberately ignores an externally configured transport.
  source=once(source,'const assetSource=assetLoader||(embedded?path=>embedded.loadAsset(path):defaultLoader);','const assetSource=path=>embedded.loadAsset(path);','asset loader selection');
  if(/\bfetch\s*\(|\bimport\.meta\b/.test(source))throw Error('A direct runtime fetch or relative module URL remains in the standalone adapter');
  return source;
}

const readyMarkup=`<script id="paddle-standalone-ready">
globalThis.PDFPaddleReady=new Promise((resolve,reject)=>{globalThis.__paddleStandaloneResolve=resolve;globalThis.__paddleStandaloneReject=reject;});
globalThis.PDFPaddleReady.catch(()=>{});
</script>`;

function staticShellAudit(html){
  const scripts=[...html.matchAll(/<script\b([^>]*)>/gi)];
  if(scripts.some(match=>/\bsrc\s*=/.test(match[1])))throw Error('PDF Studio shell contains an external script source');
  if(/<script\b[^>]*type=["']importmap["']/i.test(html))throw Error('PDF Studio shell still needs an import map');
  const tags=[...html.matchAll(/<(?:link|img|iframe|source|audio|video)\b[^>]*>/gi)];
  const remoteTags=tags.map(match=>match[0]).filter(tag=>/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(tag));
  if(remoteTags.length)throw Error('PDF Studio shell has a remote resource tag: '+remoteTags[0]);
  if(/id=["'](?:ocr-client|ocr-worker|geminiTools)["']/.test(html))throw Error('Legacy OCR/cloud UI remains in the shell');
  if(!html.includes('globalThis.PDFOCR={apply}'))throw Error('The existing searchable-PDF writer was not retained');
  if(!html.includes('<!-- markup-licenses:start -->')||!html.includes('SIL OPEN FONT LICENSE'))throw Error('Original PDF Studio markup/font notices were not retained');
  if(!html.includes(PADDLE_EXPECTED_MODEL))throw Error('PDF Studio provider identity does not match the engine');
  return {externalScriptTags:0,externalResourceTags:0,importMaps:0,legacyOCRRuntime:false,pdfTextWriterRetained:true,originalFontNoticesRetained:true};
}

export async function preparePDFStudioStandalone(){
  const [runtimeSource,preprocessSource,uiBuilderSource,assets]=await Promise.all([
    readFile(resolve(ROOT,'paddle-session.mjs'),'utf8'),readFile(resolve(ROOT,'preprocess.mjs'),'utf8'),
    readFile(resolve(ROOT,'build-pdf-studio-experiment.mjs'),'utf8'),collectStandaloneAssets(),
  ]);
  const adapted=adaptPDFPaddleRuntime(runtimeSource);
  const bundle=await bundleBrowser({source:adapted});
  const inputs=Object.keys(bundle.metafile.inputs).map(path=>path.replaceAll('\\','/'));
  if(inputs.some(path=>/dev-qa\.mjs|test-pdf-studio|fixtures\/qa/i.test(path)))throw Error('QA-only code entered the distributable browser bundle');
  const nativeInputs=inputs.filter(path=>/node_modules\/(?:onnxruntime-node|sharp|@img\/)/.test(path)||path.startsWith('node:'));
  if(nativeInputs.length)throw Error('Native dependencies entered the browser bundle: '+nativeInputs.join(', '));
  const ortInputs=inputs.filter(path=>path.endsWith('/onnxruntime-web/dist/ort.webgpu.min.mjs'));
  if(ortInputs.length!==1)throw Error('The tokenizer and inference runtime must share exactly one ORT singleton');
  // ORT dynamically imports the embedded Emscripten glue using the Blob URL set
  // by configureORT. No static/bare/native imports remain in the bundle graph.
  const imports=Object.values(bundle.metafile.outputs).flatMap(output=>output.imports);
  if(imports.some(item=>item.external))throw Error('An external module import remains after bundling');
  const runtimeCode=`try{\n${bundle.code}\nif(globalThis.PDFPaddle?.model!==${JSON.stringify(PADDLE_EXPECTED_MODEL)})throw Error('Paddle runtime model identity mismatch');globalThis.__paddleStandaloneResolve(globalThis.PDFPaddle);\n}catch(error){globalThis.__paddleStandaloneReject(error);console.error('Paddle standalone runtime failed',error);}finally{delete globalThis.__paddleStandaloneResolve;delete globalThis.__paddleStandaloneReject;}`;
  const ui=buildPDFStudioExperiment({runtimeMarkup:readyMarkup,csp:''});
  const audit=staticShellAudit(ui.html);
  const metadata={purpose:'PDF Studio UI with experimental browser-only PaddleOCR-VL-1.5 provider; not a production release',
    directFileExecution:'unverified: available browser tool explicitly blocks file://; no alternate navigation used',
    verificationScope:'static package inspection only; HTTP development-build browser tests are separate',
    engineSourceSHA256:sha(runtimeSource),preprocessSourceSHA256:sha(preprocessSource),uiBuilderSHA256:sha(uiBuilderSource),
    ui:ui.metadata,staticAudit:{...audit,nativeBundleInputs:0,externalBundleImports:0,ortSingletons:ortInputs.length,
      qaOnlyBundleInputs:0,
      directEngineFetchRemoved:true,relativeEngineFallbackRemoved:true,dynamicGlueImport:'embedded Blob URL only',
      modelCache:'decoded Uint8Array preserved for repeated OCR sessions'},
    bundleBytes:Buffer.byteLength(runtimeCode)};
  return {html:ui.html,runtimeCode,assets,metadata};
}

export async function buildPDFStudioStandalone({outfile=resolve(ROOT,'pdf-studio-paddle-standalone-experiment.html'),checkOnly=false}={}){
  outfile=resolve(outfile);const rel=relative(ROOT,outfile);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Experimental output must stay inside '+ROOT);
  const prepared=await preparePDFStudioStandalone();
  if(checkOnly)return {checkOnly:true,outfile,metadata:prepared.metadata,assets:prepared.assets.length};
  const result=await writeStandalone({...prepared,outfile});
  await writeFile(outfile+'.build.json',JSON.stringify({outfile,htmlBytes:result.bytesWritten,...prepared.metadata},null,2)+'\n');
  return {outfile,htmlBytes:result.bytesWritten,metadata:prepared.metadata};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),outputIndex=args.indexOf('--output');
  console.log(JSON.stringify(await buildPDFStudioStandalone({checkOnly:args.includes('--check'),outfile:outputIndex<0?undefined:args[outputIndex+1]}),null,2));
}
