// Cloud Vision v1, document OCR using Google's latest model channel. No uploads or results are logged/stored.
export function createVisionWorker(upstreamFetch,{readJSON,json,RequestError,validInput}){
 const fail=(message='Google Vision 결과의 텍스트 또는 위치를 확인하지 못했습니다.')=>{throw new RequestError(502,message,'VISION_RESULT_INVALID');};
 function normalize(data){
   if(!Array.isArray(data?.responses)||data.responses.length!==1)fail();
   const response=data.responses[0];if(!response||typeof response!=='object')fail();
   if(response.error)throw mappedError(response.error,502);
   const full=response.fullTextAnnotation;if(!full){if(response.textAnnotations?.length)fail();return {text:'',words:[]};}
   if(typeof full.text!=='string'||full.text.length>60000||!Array.isArray(full.pages)||full.pages.length!==1)fail();
   const words=[];let chars=0;
   for(const page of full.pages){
     if(!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<=0||page.height<=0||!Array.isArray(page.blocks))fail();
     for(const block of page.blocks){if(!Array.isArray(block.paragraphs))fail();for(const para of block.paragraphs){
       if(!Array.isArray(para.words))fail();
       for(const word of para.words){
         if(!Array.isArray(word.symbols)||!word.symbols.length||word.symbols.some(s=>typeof s?.text!=='string'))fail();
         const text=word.symbols.map(s=>s.text).join('');chars+=text.length;
         if(!text.trim()||text.length>2000||chars>60000||words.length>=10000||/[\u0000-\u0008\u000b-\u001f]/.test(text))fail();
         const vertices=word.boundingBox?.vertices;if(!Array.isArray(vertices)||vertices.length!==4)fail();
         const points=vertices.map(v=>[v?.x??0,v?.y??0]);if(points.some(p=>!p.every(Number.isFinite)))fail();
         const box=[Math.min(...points.map(p=>p[0]))/page.width,Math.min(...points.map(p=>p[1]))/page.height,Math.max(...points.map(p=>p[0]))/page.width,Math.max(...points.map(p=>p[1]))/page.height].map(n=>Math.max(0,Math.min(1,n)));
         if(box[2]<=box[0]||box[3]<=box[1])fail();
         const br=word.symbols.at(-1).property?.detectedBreak?.type||word.property?.detectedBreak?.type;
         const separator=['LINE_BREAK','EOL_SURE_SPACE','HYPHEN'].includes(br)?'\n':['SPACE','SURE_SPACE'].includes(br)?' ':'';
         if(word.confidence!==undefined&&typeof word.confidence!=='number')fail();
         const confidence=word.confidence===undefined?null:word.confidence*100;
         if(confidence!==null&&(!Number.isFinite(confidence)||confidence<0||confidence>100))fail();
         words.push({text,box,separator,confidence});
       }
       if(words.length)words.at(-1).separator='\n';
     }}
   }
   if(full.text.trim()&&!words.length)fail();return {text:full.text,words};
 }
 function mappedError(error,status){
   const reasons=Array.isArray(error?.details)?error.details.map(d=>d.reason):[],code=error?.code;
   if(code===8||status===429)return new RequestError(429,'Google Vision 호출 한도에 도달했습니다. Google Cloud의 할당량을 확인해 주세요.','VISION_QUOTA',60);
   if(reasons.includes('BILLING_DISABLED'))return new RequestError(503,'Google Cloud 프로젝트의 결제 연결이 필요합니다.','VISION_BILLING');
   if(reasons.includes('SERVICE_DISABLED'))return new RequestError(503,'Google Cloud 프로젝트에서 Cloud Vision API를 활성화해 주세요.','VISION_API_DISABLED');
   if(code===7||code===16||status===401||status===403||reasons.some(r=>String(r).startsWith('API_KEY_')))return new RequestError(503,'Google Vision API 키 또는 프로젝트 권한을 확인해 주세요.','VISION_AUTH');
   if(code===3||status===400)return new RequestError(400,'Google Vision이 페이지 이미지를 처리하지 못했습니다. 다른 페이지로 시험해 주세요.','VISION_IMAGE');
   return new RequestError(502,'Google Vision 서버가 인식을 완료하지 못했습니다. 잠시 후 다시 시도하세요.','VISION_UPSTREAM');
 }
 return {async fetch(request,env){
   const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'허용되지 않은 요청 출처입니다.'},403);
   if(request.method==='GET')return json({available:!!env.GOOGLE_VISION_API_KEY,model:'builtin/latest'});
   if(request.method!=='POST')return json({error:'POST 요청이 필요합니다.'},405,{Allow:'GET, POST'});
   try{
     if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new RequestError(415,'JSON 요청이 필요합니다.');
     const body=await readJSON(request,8*1024*1024+4096,request.signal);validInput(body);
     if(!env.GOOGLE_VISION_API_KEY)throw new RequestError(503,'Google Vision 서버 키가 아직 설정되지 않았습니다. Cloudflare에 GOOGLE_VISION_API_KEY를 등록해 주세요.','VISION_NOT_CONFIGURED');
     if(!env.OCR_RATE_LIMIT)throw new RequestError(503,'OCR 요청 제한 설정을 확인해 주세요.');
     const {success}=await env.OCR_RATE_LIMIT.limit({key:'pdf-vision-ocr'});if(!success)throw new RequestError(429,'Google Vision 요청이 많습니다. 1분 뒤 다시 시도하세요.','VISION_RATE_LIMIT',60);
     const ctrl=new AbortController(),abort=()=>ctrl.abort(request.signal.reason),timer=setTimeout(()=>ctrl.abort(new RequestError(504,'Google Vision 응답 시간이 초과됐습니다.','VISION_TIMEOUT')),45000);
     request.signal.addEventListener('abort',abort,{once:true});
     try{
       request.signal.throwIfAborted();
       const response=await upstreamFetch('https://vision.googleapis.com/v1/images:annotate',{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json','x-goog-api-key':env.GOOGLE_VISION_API_KEY},body:JSON.stringify({requests:[{image:{content:body.image},features:[{type:'DOCUMENT_TEXT_DETECTION',model:'builtin/latest'}],imageContext:{languageHints:body.language==='eng'?['en']:['ko','en']}}]})});
       let data;try{data=await readJSON(response,8*1024*1024,ctrl.signal);}catch(e){ctrl.signal.throwIfAborted();if(!response.ok)throw mappedError({},response.status);fail();}
       if(!response.ok)throw mappedError(data.error,response.status);
       return json({...normalize(data),model:'builtin/latest'});
     }catch(e){ctrl.signal.throwIfAborted();throw e;}
     finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
   }catch(e){const error=e instanceof RequestError?e:request.signal.aborted?new RequestError(499,'Google Vision 인식을 취소했습니다.','VISION_CANCELLED'):new RequestError(502,'Google Vision 연결에 실패했습니다.','VISION_CONNECTION');return json({error:error.message,code:error.code,...(error.retryAfter?{retryAfter:error.retryAfter}:{})},error.status,error.retryAfter?{'Retry-After':String(error.retryAfter)}:{});}
 }};
}
