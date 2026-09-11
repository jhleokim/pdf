/* Build-only Paddle UI overrides. Never modifies index.html or src/.
 * Runtime injection contract: globalThis.PDFPaddle.session(language, signal,
 * onProgress, layout) => {close(), recognize(canvas)}. Recognition must use
 * actual Paddle spotting coordinates; missing coordinates never enable PDF OCR.
 */
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {buildHTML} from '../../scripts/build.mjs';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
export const PADDLE_RUNTIME_MARKER='<!-- paddle-runtime:inject -->';
export const PADDLE_PROVIDER='paddle-vl15';
export const PADDLE_MODEL_REVISION='ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4';
export const PADDLE_EXPECTED_MODEL='PaddleOCR-VL-1.5/community-Q4/'+PADDLE_MODEL_REVISION+'/browser-v1';
export const PADDLE_CACHE_TAG=PADDLE_EXPECTED_MODEL+'/spotting';
const read=path=>readFileSync(resolve(root,path),'utf8').replace(/\r\n/g,'\n').trim();
const sha=value=>createHash('sha256').update(value).digest('hex');

function once(source,oldValue,newValue,label=oldValue){
  const at=source.indexOf(oldValue);
  if(at<0||source.indexOf(oldValue,at+oldValue.length)!==-1)throw Error('Expected one patch target: '+label);
  return source.slice(0,at)+newValue+source.slice(at+oldValue.length);
}
function moduleHTML(html,id,code){
  const marker='<script id="'+id+'">',at=html.indexOf(marker),end=html.indexOf('</script>',at);
  if(at<0||end<0)throw Error('Missing source module: '+id);
  new Script(code,{filename:id+'-paddle-experiment.js'});
  return html.slice(0,at+marker.length)+'\n'+code+'\n'+html.slice(end);
}
function removeBlock(html,name){
  const start='<!-- '+name+':start -->',end='<!-- '+name+':end -->';
  const a=html.indexOf(start),b=html.indexOf(end,a);
  if(a<0||b<a)throw Error('Missing bundled block: '+name);
  return html.slice(0,a)+html.slice(b+end.length);
}

const helpers=String.raw`
const PADDLE_MODEL_CACHE_TAG=${JSON.stringify(PADDLE_CACHE_TAG)};
const PADDLE_EXPECTED_RUNTIME_MODEL=${JSON.stringify(PADDLE_EXPECTED_MODEL)};
function paddleValidWord(word){
  const box=word?.box;
  return typeof word?.text==='string'&&word.text.trim()&&Array.isArray(box)&&box.length===4&&
    box.every(Number.isFinite)&&box[0]>=0&&box[1]>=0&&box[2]<=1&&box[3]<=1&&box[2]>box[0]&&box[3]>box[1];
}
function paddleCanEmbed(record){return !!record&&!record.skipped&&record.source==='paddle-vl15'&&record.canEmbed===true&&Array.isArray(record.words)&&record.words.length>0&&record.words.every(paddleValidWord);}
function paddleHasText(record){return !record.skipped&&!!record.text?.trim();}
async function startPaddleSession(language,signal,onProgress,layout){
  if(globalThis.PDFPaddleReady)await waitForOCR(globalThis.PDFPaddleReady,signal);
  signal.throwIfAborted();
  if(typeof globalThis.PDFPaddle?.session!=='function')throw new Error('Paddle 실험 런타임이 준비되지 않았습니다. 모델이 포함된 실험 파일을 열어 주세요.');
  if(globalThis.PDFPaddle.model!==PADDLE_EXPECTED_RUNTIME_MODEL)throw new Error('실험용 Paddle 모델 버전이 일치하지 않습니다. 실험 파일을 다시 빌드해 주세요.');
  const session=await globalThis.PDFPaddle.session(language,signal,onProgress,layout);
  return {close:()=>session.close(),async recognize(canvas){
    const result=await session.recognize(canvas);signal.throwIfAborted();
    if(!result||typeof result.text!=='string')throw new Error('Paddle 인식 결과 형식을 확인하지 못했습니다.');
    if(result.model&&result.model!==PADDLE_EXPECTED_RUNTIME_MODEL)throw new Error('인식 결과의 모델 버전이 일치하지 않습니다. 다시 인식해 주세요.');
    const stopped=result.stop_reason??result.stopReason;
    if(result.status&&result.status!=='complete'||stopped&&stopped!=='eos')throw new Error('Paddle 인식이 끝까지 완료되지 않았습니다. 페이지를 나누어 다시 시도해 주세요.');
    const actual=Array.isArray(result.words)?result.words:[],valid=actual.length>0&&actual.every(paddleValidWord);
    // Never fabricate locations or an engine confidence percentage.
    const words=valid?actual.map(({confidence,...word})=>({...word})):[];
    return {...result,words,confidence:null,canEmbed:valid,modelCacheTag:PADDLE_MODEL_CACHE_TAG,
      coordinateStatus:valid?'model-spotting':'unavailable',
      geometryNote:valid?'':'줄 위치를 확인하지 못했습니다. 텍스트는 저장할 수 있지만 검색용 PDF에는 포함하지 않습니다.'};
  }};
}
`;

export function overridePaddleToolsUI(source){
  let code=once(source,"'use strict';","'use strict';\n"+helpers,'strict prelude');
  code=once(code,"function ocrKey(p,o){return JSON.stringify([p.uid,","function ocrKey(p,o){return JSON.stringify([PADDLE_MODEL_CACHE_TAG,p.uid,",'cache identity');
  code=once(code,"provider='tesseract'","provider='paddle-vl15'",'default provider');
  code=once(code,"  if(provider!=='tesseract'&&typeof PDFGemini==='undefined')return;","  if(provider!=='paddle-vl15'){toast('이 실험 파일은 Paddle 인식만 사용합니다.',true);return;}",'provider guard');
  code=once(code,"  if(provider==='gemini'&&consent!==true){toast('민감정보 없는 문서임을 먼저 확인해 주세요.',true);return;}\n",'', 'cloud consent branch');
  code=once(code,"startProWork(provider==='gemini'?'Gemini 인식을 준비하는 중…':'텍스트 인식을 준비하는 중…');","startProWork('PaddleOCR-VL-1.5 모델을 준비하는 중…');",'startup feedback');
  // Layout remains an inert hidden auto field so shared app state/IDs stay valid.
  code=code.replaceAll("provider==='gemini'||", "provider==='paddle-vl15'||");
  code=once(code,"(provider==='paddle-vl15'||r.layout===layout)&&!r.skipped;","(provider==='paddle-vl15'||r.layout===layout)&&!r.skipped&&paddleCanEmbed(r);",'coordinate cache gate');
  const progressStart=code.indexOf('            const onProgress=m=>{');
  const progressEnd=code.indexOf('\n          }\n          const result=',progressStart);
  if(progressStart<0||progressEnd<0)throw Error('OCR progress/session patch target changed');
  code=code.slice(0,progressStart)+String.raw`            const onProgress=m=>{
              if(proAbort?.signal.aborted)return;
              const label=m.status==='recognizing text'?'Paddle 텍스트 인식 중':'Paddle 모델 준비 중';
              const detail=m.detail?' · '+String(m.detail):'';
              busy(true,recognizingPage+'쪽 · '+label+detail+' ('+(position+1)+'/'+list.length+')');
              // Token count is not a known completion percentage. Only mark a
              // page complete when the real runtime reports completion.
              if(m.status==='recognizing text'&&m.progress===1)update(.98);
            };
            engine=await startPaddleSession(language,proAbort.signal,onProgress,layout);`+code.slice(progressEnd);
  code=once(code,"${provider==='gemini'?'Gemini · ':''}",'PaddleOCR-VL-1.5 · ','provider completion label');
  code=once(code,"recognized=ocrRecords.filter(r=>r.words.length).length","recognized=ocrRecords.filter(paddleHasText).length",'recognition summary count');
  code=once(code,"`${recognized}쪽 · ${ocrAccepted?'검색 텍스트 포함':'인식 결과 확인 중'}`","`${ocrAccepted?ocrRecords.filter(paddleCanEmbed).length:recognized}쪽 · ${ocrAccepted?'검색 텍스트 포함':'인식 결과 확인 중'}`",'accepted summary count');
  code=once(code," 내용을 확인한 뒤 PDF 포함을 선택하세요.`;","${ocrRecords.some(paddleCanEmbed)?' 내용을 확인한 뒤 PDF 포함을 선택하세요.':fresh.some(paddleHasText)?' 텍스트는 저장할 수 있지만 검색용 PDF에 포함할 위치 정보가 없습니다.':' 기존 검색 텍스트를 유지합니다.'}`;",'completion action availability');
  code=once(code,"o.ocr=ocrAccepted?valid.filter(r=>!r.skipped):[];return o;","o.ocr=ocrAccepted?valid.filter(paddleCanEmbed):[];return o;",'PDF coordinate gate');
  code=once(code,"$('ocrAccept').disabled=stale||!ocrRecords.some(r=>r.words.length)||ocrAccepted;","$('ocrAccept').disabled=stale||!ocrRecords.some(paddleCanEmbed)||ocrAccepted;",'accept enabled state');
  code=once(code,"ocrRecords.filter(r=>r.words.length).length}쪽이 결과 PDF에 포함됩니다.","ocrRecords.filter(paddleCanEmbed).length}쪽이 결과 PDF에 포함됩니다.",'accepted count');
  code=once(code,"!r.words.length?' · 인식한 글자 없음':''","!r.text?.trim()?' · 인식한 글자 없음':!paddleCanEmbed(r)?' · 텍스트만 · 위치 없음':''",'result selector state');
  const renderStart=code.indexOf('function renderOCRText(){'),renderEnd=code.indexOf("\n$('ocrSample').onclick",renderStart);
  if(renderStart<0||renderEnd<0)throw Error('OCR result rendering patch target changed');
  code=code.slice(0,renderStart)+String.raw`function renderOCRText(){
  const r=ocrRecords[Number($('ocrResultPage').value)];if(!r)return;
  const host=$('ocrText');host.replaceChildren();
  if(r.skipped||!r.words.length)host.textContent=r.text;
  else for(const word of r.words){const span=document.createElement('span');span.textContent=word.text+(word.separator??' ');if(word.uncertain){span.className='uncertain';span.title='글자와 위치를 확인해 주세요.';}host.append(span);}
  $('ocrConfidence').textContent=r.skipped?'이 페이지에는 새 OCR을 추가하지 않습니다.':paddleCanEmbed(r)?'PaddleOCR-VL-1.5 · '+r.words.length+'개 글줄 · 신뢰도 점수는 제공하지 않습니다. 줄 단위 위치라 단어 선택 영역은 실제 글자와 다를 수 있습니다. 원본 글꼴을 알 수 없어 내장 글꼴의 문자 폭으로 추정합니다.':r.geometryNote||'줄 위치가 없어 텍스트 저장만 가능합니다. 검색용 PDF에는 포함하지 않습니다.';
}`+code.slice(renderEnd);
  code=once(code,"$('ocrAccept').onclick=()=>{ocrAccepted=true;toolsChanged();syncToolsState();};","$('ocrAccept').onclick=()=>{if($('ocrAccept').disabled||!ocrRecords.some(paddleCanEmbed))return;ocrAccepted=true;toolsChanged();syncToolsState();};",'accept click guard');
  if(code.includes("provider==='gemini'")||code.includes("provider='tesseract'")||code.includes('PDFOCR.session(')||code.includes('PDFGemini.session('))throw Error('Legacy provider path remains in experimental OCR UI');
  new Script(code,{filename:'pro-tools-ui-paddle-experiment.js'});
  return code;
}

function pdfTextApplicationOnly(source){
  const start=source.indexOf('  function makeFont('),end=source.indexOf('  globalThis.PDFOCR={session,apply};');
  if(start<0||end<0)throw Error('PDF OCR application utility changed');
  let application=source.slice(start,end);
  application=once(application,'  function makeFont(doc,records){',String.raw`  async function makeFont(doc,records,signal){
    check(signal);
    const {font:metrics}=await PDFMarkupText.load('gothic');check(signal);
    const em=metrics.unitsPerEm;
    if(!Number.isFinite(em)||em<=0)throw new Error('검색 텍스트의 글꼴 크기 정보를 읽지 못했습니다.');
    // Spotting gives line boxes, not source-font metrics or character boxes.
    // Use bundled NanumGothic proportions as an explicit approximation.
    const glyphWidth=ch=>{
      const point=ch.codePointAt(0);
      if(!metrics.hasGlyphForCodePoint(point))return 600;
      const width=metrics.glyphForCodePoint(point).advanceWidth/em*1000;
      if(!Number.isFinite(width)||width<0)throw new Error('검색 텍스트의 문자 폭을 읽지 못했습니다.');
      return width;
    };`,'proportional OCR font metrics');
  application=once(application,'    const map=new Map(chars.map((ch,i)=>[ch,i+1]));','    const map=new Map(chars.map((ch,i)=>[ch,i+1]));\n    const widths=chars.map(glyphWidth),widthMap=new Map(chars.map((ch,i)=>[ch,widths[i]]));','OCR width map');
  application=once(application,"FontDescriptor:descriptor,DW:600,CIDToGIDMap:'Identity'","FontDescriptor:descriptor,DW:600,W:[1,widths],CIDToGIDMap:'Identity'",'CID proportional widths');
  application=once(application,'    return {ref,encode:text=>','    return {ref,measure:text=>[...text].reduce((sum,ch)=>sum+widthMap.get(ch),0)/1000,encode:text=>','OCR line measurement');
  application=once(application,'font=makeFont(doc,active);let pages=0,words=0;','font=await makeFont(doc,active,signal);check(signal);let pages=0,words=0;','await OCR font metrics');
  application=once(application,"        const text=word.text+(word.separator===''?'':' '),sx=(rt-l)*w/(Math.max(1,[...word.text].length)*.6),sy=(bt-t)*h;",String.raw`        const measured=font.measure(word.text);if(!(measured>0))continue;
        const text=word.text+(word.separator===''?'':' '),sx=(rt-l)*w/measured,sy=(bt-t)*h;`,'proportional OCR text matrix');
  const code="(() => { 'use strict';\nconst check=signal=>{if(signal?.aborted)throw new DOMException('취소했습니다.','AbortError');};\n"+application+"globalThis.PDFOCR={apply};\n})();";
  new Script(code,{filename:'pro-ocr-apply-only.js'});
  return code;
}

export function buildPDFStudioExperiment({runtimeMarkup=PADDLE_RUNTIME_MARKER,csp="connect-src 'self' blob: data:; img-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'"}={}){
  if(typeof runtimeMarkup!=='string')throw Error('runtimeMarkup must be HTML containing the real runtime script(s)');
  let html=buildHTML({standalone:true}); // Pure return value: upstream sources are never written.
  html=removeBlock(removeBlock(html,'ocr-assets'),'ocr-licenses');
  html=moduleHTML(html,'pro-ocr',pdfTextApplicationOnly(read('src/pro-ocr.js')));
  const ui=overridePaddleToolsUI(read('src/pro-tools-ui.js'));
  html=moduleHTML(html,'pro-tools-ui',ui);
  html=once(html,'<script id="pro-tools-ui">',runtimeMarkup+'\n<script id="pro-tools-ui">','runtime insertion');
  html=once(html,'<b>네트워크 0건</b>','<b>브라우저에서 인식</b>','local processing claim');
  html=html.replaceAll('네트워크 요청 0건.','문서 인식은 브라우저에서 처리합니다.');
  const language='<label class="pro-field" for="ocrLanguage"><span>인식 언어</span><select id="ocrLanguage"><option value="kor+eng">한국어 + 영어</option><option value="eng">영어</option></select></label>';
  html=once(html,language,'<label class="pro-field" for="ocrLanguage" hidden><span>인식 언어</span><select id="ocrLanguage" disabled><option value="auto">다국어 자동</option></select></label>','language UI');
  const layout='<label class="pro-field" for="ocrLayout"><span>문서 구성</span><select id="ocrLayout"><option value="auto">자동</option><option value="6">본문 위주 · 한 단</option><option value="11">흩어진 글자 · 서식과 영수증</option></select></label>';
  html=once(html,layout,'<label class="pro-field" for="ocrLayout" hidden><span>문서 구성</span><select id="ocrLayout" disabled><option value="auto">Paddle 자동 인식</option></select></label>','PSM UI');
  html=once(html,'원래 페이지 모습은 유지하고 검색용 텍스트를 추가합니다. 먼저 한 페이지를 인식해 품질을 확인하세요.','<strong>PaddleOCR-VL-1.5 · 실험용</strong><br>원래 페이지 모습은 유지합니다. 먼저 한 페이지의 글자와 줄 위치를 확인하세요. 브라우저용 변환 모델로, PC의 WebGPU 환경이 필요합니다. 준비와 인식에 시간이 걸릴 수 있습니다. 단일 HTML 시험판은 약 1.2GiB입니다.','provider description');
  html=once(html,'검색 가능한 텍스트가 있는 페이지는 건너뜁니다. 기본 인식은 Tesseract로 처리하며 문서를 외부로 전송하지 않습니다.','검색 가능한 텍스트가 있는 페이지는 건너뜁니다. Paddle 모델을 이 브라우저에서 실행하며 문서를 외부로 전송하지 않습니다.','processing notice');
  html=once(html,'인식 엔진과 한글·영어 데이터가 포함되어 오프라인에서도 사용할 수 있습니다.','첫 인식 때 Paddle 모델을 메모리에 준비합니다. 준비가 끝난 뒤 글자를 인식합니다.','initial status');
  html=once(html,'밑줄은 엔진 확신도가 낮은 단어입니다. 확신도는 실제 정확도와 다릅니다.','신뢰도 점수는 제공하지 않습니다. 줄 단위 위치라 단어 선택 영역은 실제 글자와 다를 수 있습니다. 원본 글꼴을 알 수 없어 내장 글꼴의 문자 폭으로 추정합니다. 줄 위치를 확인할 수 없는 결과는 텍스트로만 저장할 수 있습니다.','confidence explanation');
  html=html.replace(/<title>[\s\S]*?<\/title>/i,'<title>PDF Studio · PaddleOCR-VL-1.5 실험</title>');
  html=once(html,'<head>','<head>\n<meta name="pdfstudio-ocr-experiment" content="'+PADDLE_CACHE_TAG+'">\n'+(csp?'<meta http-equiv="Content-Security-Policy" content="'+csp.replaceAll('"','&quot;')+'">\n':''),'experiment meta');
  html=html.replace(/(<span class="app-version"[^>]*>)([^<]+)(<\/span>)/,'$1$2 · Paddle 실험$3');
  if(html.includes('id="geminiTools"')||html.includes('id="ocr-client"')||html.includes('id="ocr-worker"'))throw Error('Unexpected legacy OCR runtime in experimental build');
  const metadata={provider:PADDLE_PROVIDER,model_revision:PADDLE_MODEL_REVISION,cache_tag:PADDLE_CACHE_TAG,
    runtime_injected:runtimeMarkup!==PADDLE_RUNTIME_MARKER,bytes:Buffer.byteLength(html),source_index_sha256:sha(readFileSync(resolve(root,'index.html'))),
    overrides:['provider/cache identity','Paddle progress details without guessed percent','text and coordinate validation','PDF embedding coordinate gate','approximate proportional OCR character metrics','confidence removal','PSM/language fields hidden','legacy Tesseract assets/session removed','Gemini excluded'],
    source_files_modified:false};
  return {html,metadata};
}

function main(){
  const args=process.argv.slice(2),value=flag=>{const at=args.indexOf(flag);return at<0?null:args[at+1];};
  if(args.includes('--help')){console.log('node build-pdf-studio-experiment.mjs [--check] [--runtime-markup runtime-snippet.html] [--output experimental.html]\nRuntime snippet must register globalThis.PDFPaddle.session. No snippet leaves '+PADDLE_RUNTIME_MARKER+' for the packager.');return;}
  const runtimeFile=value('--runtime-markup'),output=resolve(value('--output')||resolve(here,'pdf-studio-paddle-experiment.html'));
  const allowed=relative(here,output);
  if(allowed.startsWith('..')||resolve(output)===resolve(root,'index.html'))throw Error('Experimental output must stay inside the experiment directory');
  const result=buildPDFStudioExperiment({runtimeMarkup:runtimeFile?readFileSync(resolve(runtimeFile),'utf8'):PADDLE_RUNTIME_MARKER});
  if(!args.includes('--check')){mkdirSync(dirname(output),{recursive:true});writeFileSync(output,result.html);}
  console.log(JSON.stringify({...result.metadata,check_only:args.includes('--check'),output:args.includes('--check')?null:output},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
