import VisionResult from '../src/pro-vision-result.js';
import {Buffer} from 'node:buffer';

const MAX_IMAGE=6*1024*1024,MAX_RESULT=8*1024*1024;
const wordFields='boundingBox,confidence,property(detectedBreak),symbols(text,property(detectedBreak))';
// Keep word geometry and reading breaks; omit duplicate and per-character geometry.
const fields='responses(error,textAnnotations(locale),fullTextAnnotation(text,pages(width,height,blocks(paragraphs(words('+wordFields+'))))))';
const upstreamURL='https://vision.googleapis.com/v1/images:annotate?prettyPrint=false&fields='+encodeURIComponent(fields);

export function createVisionWorker(upstreamFetch,{readBytes,readJSON,json,RequestError,validInput}){
 const {normalize,mappedError}=VisionResult.createNormalizer(RequestError);
 const invalid=()=>new RequestError(502,'Google Vision 결과 형식을 확인하지 못했습니다.','VISION_RESULT_INVALID');
 return {async fetch(request,env){
   const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'허용되지 않은 요청 출처입니다.'},403);
   if(request.method==='GET')return json({available:!!env.GOOGLE_VISION_API_KEY,model:'builtin/latest'});
   if(request.method!=='POST')return json({error:'POST 요청이 필요합니다.'},405,{Allow:'GET, POST'});
   try{
     const type=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase(),binary=type==='image/jpeg';
     let language,image;
     if(binary){
       language=request.headers.get('x-ocr-language');
       if(request.headers.get('x-ocr-consent')!=='true')throw new RequestError(400,'민감정보 없는 문서임을 먼저 확인해 주세요.');
       if(!['eng','kor+eng'].includes(language))throw new RequestError(400,'올바른 인식 언어가 필요합니다.');
       const bytes=await readBytes(request,MAX_IMAGE,request.signal);
       if(bytes.length<12||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw new RequestError(400,'올바른 JPEG 이미지가 필요합니다.');
       image=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64');
     }else{
       if(type!=='application/json')throw new RequestError(415,'JPEG 또는 JSON 요청이 필요합니다.');
       const body=await readJSON(request,8*1024*1024+4096,request.signal);validInput(body);
       ({language,image}=body);
     }
     if(!env.GOOGLE_VISION_API_KEY)throw new RequestError(503,'Google Vision 서버 키가 아직 설정되지 않았습니다. Cloudflare에 GOOGLE_VISION_API_KEY를 등록해 주세요.','VISION_NOT_CONFIGURED');
     if(!env.OCR_RATE_LIMIT)throw new RequestError(503,'OCR 요청 제한 설정을 확인해 주세요.');
     const {success}=await env.OCR_RATE_LIMIT.limit({key:'pdf-vision-ocr'});if(!success)throw new RequestError(429,'Google Vision 요청이 많습니다. 1분 뒤 다시 시도하세요.','VISION_RATE_LIMIT',60);
     const ctrl=new AbortController(),abort=()=>ctrl.abort(request.signal.reason),timer=setTimeout(()=>ctrl.abort(new RequestError(504,'Google Vision 응답 시간이 초과됐습니다.','VISION_TIMEOUT')),45000);
     request.signal.addEventListener('abort',abort,{once:true});
     let handedOff=false;
     const cleanup=()=>{clearTimeout(timer);request.signal.removeEventListener('abort',abort);};
     try{
       request.signal.throwIfAborted();
       // Validated base64 and fixed language literals need no multi-megabyte JSON serialization.
       const body='{"requests":[{"image":{"content":"'+image+'"},"features":[{"type":"DOCUMENT_TEXT_DETECTION","model":"builtin/latest"}],"imageContext":{"languageHints":'+(language==='eng'?'["en"]':'["ko","en"]')+'}}]}';
       const response=await upstreamFetch(upstreamURL,{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json','x-goog-api-key':env.GOOGLE_VISION_API_KEY},body});
       if(!response.ok){
         let data;try{data=await readJSON(response,64*1024,ctrl.signal);}catch(_){ctrl.signal.throwIfAborted();}
         throw mappedError(data?.error,response.status);
       }
       if(!binary){
         let data;try{data=await readJSON(response,MAX_RESULT,ctrl.signal);}catch(_){ctrl.signal.throwIfAborted();throw invalid();}
         return json({...normalize(data),model:'builtin/latest'});
       }
       // Browser validation is identical. Stream with backpressure instead of normalizing
       // every OCR word inside the Worker's 10 ms CPU budget.
       if(!response.headers.get('content-type')?.includes('application/json')||!response.body||Number(response.headers.get('content-length'))>MAX_RESULT){await response.body?.cancel();throw invalid();}
       const reader=response.body.getReader();let size=0,finished=false,stop;
       const finish=()=>{if(finished)return;finished=true;ctrl.signal.removeEventListener('abort',stop);cleanup();};
       const stream=new ReadableStream({
         start(controller){stop=()=>{finish();controller.error(ctrl.signal.reason);void reader.cancel(ctrl.signal.reason).catch(()=>{});};ctrl.signal.addEventListener('abort',stop,{once:true});if(ctrl.signal.aborted)stop();},
         async pull(controller){
           try{const {done,value}=await reader.read();if(finished)return;if(done){finish();reader.releaseLock();controller.close();return;}size+=value.byteLength;if(size>MAX_RESULT)throw invalid();controller.enqueue(value);}
           catch(e){if(finished)return;finish();controller.error(e);await reader.cancel().catch(()=>{});}
         },
         async cancel(reason){finish();ctrl.abort(reason);await reader.cancel(reason).catch(()=>{});}
       });
       handedOff=true;
       return new Response(stream,{headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-OCR-Format':'google-vision-v1'}});
     }catch(e){ctrl.signal.throwIfAborted();throw e;}
     finally{if(!handedOff)cleanup();}
   }catch(e){const error=e instanceof RequestError?e:request.signal.aborted?new RequestError(499,'Google Vision 인식을 취소했습니다.','VISION_CANCELLED'):new RequestError(502,'Google Vision 연결에 실패했습니다.','VISION_CONNECTION');return json({error:error.message,code:error.code,...(error.retryAfter?{retryAfter:error.retryAfter}:{})},error.status,error.retryAfter?{'Retry-After':String(error.retryAfter)}:{});}
 }};
}
