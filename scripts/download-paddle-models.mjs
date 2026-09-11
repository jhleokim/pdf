/** Developer/CI source preparation. Downloads public, pinned weights only.
 * Documents are never inputs to this script. The deployed OCR runs in-browser.
 */
import {copyFileSync,constants,existsSync,openSync,closeSync,writeSync,fsyncSync,
  readFileSync,renameSync,unlinkSync,realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as wait} from 'node:timers/promises';
import {MODEL,REVISION,REQUIRED_ASSETS,validateSourceManifest,verifyOriginal,safeDirectory,safeFile,atomicWrite} from './prepare-paddle-assets.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const RANGE_SIZE=8*1024*1024;

async function validFile(file,asset){try{await verifyOriginal(file,asset);return true;}catch{return false;}}

async function readBoundedBody(response,expected,signal){
  if(!response.body)throw Error('Model response has no body.');
  const reader=response.body.getReader(),buffer=Buffer.allocUnsafe(expected);let received=0;
  const abort=()=>{void reader.cancel(signal.reason).catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  try{
    signal.throwIfAborted();
    while(true){
      const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;
      if(received+value.length>expected)throw Error('Model response exceeds the requested range.');
      buffer.set(value,received);received+=value.length;
    }
    if(received!==expected)throw Error('Model response ended before the requested range was complete.');
    return buffer;
  }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

async function fetchRange({asset,start,end,fetchImpl,signal,timeoutMs,maxAttempts,retryMs}){
  const expected=end-start+1;
  for(let attempt=0;attempt<maxAttempts;attempt++){
    signal.throwIfAborted();
    const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new DOMException('Model range request timed out.','TimeoutError')),timeoutMs);
    const requestSignal=AbortSignal.any([signal,deadline.signal]);let response,retryAfter=0;
    try{
      // A distinct query keeps intermediary caches from serving a different byte range.
      const url=`https://huggingface.co/${MODEL}/resolve/${REVISION}/${asset.path}?download=true&paddle_range=${start}&attempt=${attempt}`;
      response=await fetchImpl(url,{headers:{Range:`bytes=${start}-${end}`,'Accept-Encoding':'identity'},signal:requestSignal,redirect:'follow',credentials:'omit'});
      requestSignal.throwIfAborted();
      if(response.status!==206&&!(response.status===200&&start===0&&expected===asset.size)){
        const header=response.headers.get('retry-after');
        if(header){const seconds=/^\d+(?:\.\d+)?$/.test(header)?Number(header):(Date.parse(header)-Date.now())/1000;if(Number.isFinite(seconds))retryAfter=Math.max(0,seconds*1000);}
        const error=Error(`Model range HTTP ${response.status}: ${asset.path}`);
        error.permanent=[400,401,403,404,410].includes(response.status);throw error;
      }
      if(response.status===206&&response.headers.get('content-range')!==`bytes ${start}-${end}/${asset.size}`)throw Error('Incorrect model Content-Range: '+asset.path);
      const length=response.headers.get('content-length');
      if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==expected))throw Error('Incorrect model Content-Length: '+asset.path);
      return await readBoundedBody(response,expected,requestSignal);
    }catch(error){
      signal.throwIfAborted();
      if(attempt+1===maxAttempts||error.permanent||retryAfter>30000)throw error;
    }finally{clearTimeout(timer);if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});}
    await wait(Math.max(retryMs*2**attempt,retryAfter),undefined,{signal});
  }
  throw Error('Model range attempts exhausted.');
}

export async function downloadVerifiedFile({asset,outputDirectory,fetchImpl=fetch,rangeSize=RANGE_SIZE,timeoutMs=30000,maxAttempts=3,retryMs=500,concurrency=4,overallTimeoutMs=15*60*1000}){
  if(!Number.isSafeInteger(rangeSize)||rangeSize<1||rangeSize>RANGE_SIZE)throw Error('Download ranges must be at most 8 MiB.');
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3||!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw Error('Invalid model download retry/concurrency bound.');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isFinite(overallTimeoutMs)||overallTimeoutMs<=0||!Number.isFinite(retryMs)||retryMs<0)throw Error('Invalid download deadline.');
  if(!Number.isSafeInteger(asset.size)||asset.size<1||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('Invalid source integrity record.');
  const target=safeFile(outputDirectory,asset.path),temporary=safeFile(outputDirectory,asset.path+'.tmp-'+process.pid+'-'+randomUUID());
  const control=new AbortController(),deadline=setTimeout(()=>control.abort(new DOMException('Model file download timed out.','TimeoutError')),overallTimeoutMs);
  let fd,position=0;
  try{
    fd=openSync(temporary,'wx');
    const workers=Array.from({length:Math.min(concurrency,Math.ceil(asset.size/rangeSize))},async()=>{
      while(position<asset.size){
        control.signal.throwIfAborted();
        const start=position,end=Math.min(asset.size,start+rangeSize)-1;position=end+1;
        try{
          const bytes=await fetchRange({asset,start,end,fetchImpl,signal:control.signal,timeoutMs,maxAttempts,retryMs});
          control.signal.throwIfAborted();let written=0;
          while(written<bytes.length){const count=writeSync(fd,bytes,written,bytes.length-written,start+written);if(!count)throw Error('Model file write made no progress.');written+=count;}
        }catch(error){control.abort(error);throw error;}
      }
    });
    const outcomes=await Promise.allSettled(workers),failure=outcomes.find(result=>result.status==='rejected');
    if(failure)throw control.signal.reason||failure.reason;
    control.signal.throwIfAborted();fsyncSync(fd);closeSync(fd);fd=undefined;
    await verifyOriginal(temporary,asset);control.signal.throwIfAborted();
    renameSync(temporary,target);return target;
  }finally{clearTimeout(deadline);if(fd!==undefined)closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);}
}

async function copyVerifiedFile(sourceFile,asset,outputDirectory){
  const target=safeFile(outputDirectory,asset.path),temporary=safeFile(outputDirectory,asset.path+'.tmp-'+process.pid+'-'+randomUUID());
  try{copyFileSync(sourceFile,temporary,constants.COPYFILE_EXCL);await verifyOriginal(temporary,asset);renameSync(temporary,target);}
  finally{if(existsSync(temporary))unlinkSync(temporary);}
}

export async function ensurePaddleSources({fetchImpl=fetch,onProgress=message=>console.log(message)}={}){
  const manifest=JSON.parse(readFileSync(resolve(ROOT,'vendor/paddle/model-source.json'),'utf8'));
  validateSourceManifest(manifest);
  const sourceDir=safeDirectory(ROOT,resolve(ROOT,'vendor/paddle/source',REVISION));
  const candidates=[process.env.PADDLE_MODEL_DIR,
    resolve(ROOT,'work/paddle-vl15-browser/models/paddle-vl15-community'),
    resolve(ROOT,'experiments/paddleocr-vl15/models/paddle-vl15-community')].filter(Boolean).map(directory=>resolve(directory));
  for(const asset of REQUIRED_ASSETS){
    const target=safeFile(sourceDir,asset.path);
    if(await validFile(target,asset)){onProgress('Verified existing '+asset.path);continue;}
    let copied=false;
    for(const directory of candidates){
      const local=resolve(directory,asset.path);
      if(existsSync(local)&&realpathSync(local)!==target&&await validFile(local,asset)){
        await copyVerifiedFile(local,asset,sourceDir);copied=true;onProgress('Copied verified local '+asset.path);break;
      }
    }
    if(!copied){onProgress('Downloading pinned '+asset.path);await downloadVerifiedFile({asset,outputDirectory:sourceDir,fetchImpl});onProgress('Verified download '+asset.path);}
  }
  atomicWrite(sourceDir,'source-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  return {sourceDir,sourceManifest:resolve(sourceDir,'source-manifest.json')};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length>2){console.error('Usage: node scripts/download-paddle-models.mjs\nOptional environment: PADDLE_MODEL_DIR');process.exitCode=1;}
  else console.log(JSON.stringify(await ensurePaddleSources()));
}
