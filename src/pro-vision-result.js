/* Shared strict Google Vision result validation; no response text is logged. */
(function(root){
'use strict';
function createNormalizer(RequestError){
 const fail=(message='Google Vision 결과의 텍스트 또는 위치를 확인하지 못했습니다.')=>{throw new RequestError(502,message,'VISION_RESULT_INVALID');};
 function normalize(data){
   if(!Array.isArray(data?.responses)||data.responses.length!==1)fail();
   const response=data.responses[0];if(!response||typeof response!=='object')fail();
   if(response.error)throw mappedError(response.error,502);
   const full=response.fullTextAnnotation;if(!full){if(response.textAnnotations?.length)fail();return {text:'',words:[]};}
   if(typeof full.text!=='string'||full.text.length>60000||!Array.isArray(full.pages)||full.pages.length!==1)fail();
   const words=[];let chars=0;
   for(const page of full.pages){
     if(!page||!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<=0||page.height<=0||!Array.isArray(page.blocks))fail();
     for(const block of page.blocks){if(!block||!Array.isArray(block.paragraphs))fail();for(const para of block.paragraphs){
       if(!para||!Array.isArray(para.words))fail();
       for(const word of para.words){
         if(!word||!Array.isArray(word.symbols)||!word.symbols.length||word.symbols.some(s=>typeof s?.text!=='string'))fail();
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
   const reasons=Array.isArray(error?.details)?error.details.map(d=>d?.reason):[],code=error?.code;
   if(code===8||status===429)return new RequestError(429,'Google Vision 호출 한도에 도달했습니다. Google Cloud의 할당량을 확인해 주세요.','VISION_QUOTA',60);
   if(reasons.includes('BILLING_DISABLED'))return new RequestError(503,'Google Cloud 프로젝트의 결제 연결이 필요합니다.','VISION_BILLING');
   if(reasons.includes('SERVICE_DISABLED'))return new RequestError(503,'Google Cloud 프로젝트에서 Cloud Vision API를 활성화해 주세요.','VISION_API_DISABLED');
   if(code===7||code===16||status===401||status===403||reasons.some(r=>String(r).startsWith('API_KEY_')))return new RequestError(503,'Google Vision API 키 또는 프로젝트 권한을 확인해 주세요.','VISION_AUTH');
   if(code===3||status===400)return new RequestError(400,'Google Vision이 페이지 이미지를 처리하지 못했습니다. 다른 페이지로 시험해 주세요.','VISION_IMAGE');
   return new RequestError(502,'Google Vision 서버가 인식을 완료하지 못했습니다. 잠시 후 다시 시도하세요.','VISION_UPSTREAM');
 }
 return {normalize,mappedError};
}
root.PDFVisionResult={createNormalizer};
if(typeof module!=='undefined')module.exports=root.PDFVisionResult;
})(globalThis);
