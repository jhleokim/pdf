/* Browser-only experimental PaddleOCR-VL-1.5 preprocessing. No inference/runtime dependency.
 * References (Apache-2.0):
 * https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5/blob/main/image_processing_paddleocr_vl.py
 *   smart_resize; _preprocess lines 357-420: raster-order [patch,channel,14,14].
 * https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5/blob/main/processing_paddleocr_vl.py
 *   image placeholder count = grid_t * grid_h * grid_w / merge_size**2.
 * https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5/blob/main/chat_template.jinja
 * https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5/blob/main/modeling_paddleocr_vl.py
 *   get_rope_index lines 1902-2123; subsequent generation positions lines 2251-2263.
 * https://github.com/PaddlePaddle/PaddleX/blob/develop/paddlex/inference/pipelines/paddleocr_vl/uilts.py
 *   pre/post_process_for_spotting lines 1117-1184.
 * Assumptions: one static RGB image, batch=1, temporal_patch_size=1, no padding/videos.
 * JS separable bicubic/Lanczos below follows the filter/coordinate conventions, but
 * its floating-point rounding has NOT been certified byte-identical to Pillow.
 * Spotting returns quadrilaterals. box is their axis-aligned envelope, not a claim
 * that the PDF Studio text-layer writer can reproduce curved or rotated text.
 */

export const PADDLE_SPEC=Object.freeze({patchSize:14,mergeSize:2,temporalPatchSize:1,
  minPixels:112896,maxPixels:1003520,spottingMaxPixels:1605632,
  imageTokenId:100295,visionStartTokenId:101305,visionEndTokenId:101306,
  eosTokenId:2,padTokenId:0,locTokenBase:100297,locTokenMax:101297,
  hiddenSize:1024,numLayers:18,numKvHeads:2,headDim:128});
const prompts={ocr:'OCR:',spotting:'Spotting:',table:'Table Recognition:',formula:'Formula Recognition:',chart:'Chart Recognition:',seal:'Seal Recognition:'};
const check=signal=>signal?.throwIfAborted();
const roundEven=value=>{const n=Math.floor(value),fraction=value-n;return fraction===.5?n+(n%2):Math.round(value);};
const byte=value=>Math.max(0,Math.min(255,Math.round(value)));

export function smartResize(height,width,{factor=28,minPixels=PADDLE_SPEC.minPixels,maxPixels=PADDLE_SPEC.maxPixels}={}){
  if(![height,width,factor,minPixels,maxPixels].every(Number.isFinite)||height<=0||width<=0||factor<=0||minPixels<=0||maxPixels<minPixels)throw Error('Invalid image resize dimensions or pixel limits');
  if(height<factor){width=roundEven(width*factor/height);height=factor;}
  if(width<factor){height=roundEven(height*factor/width);width=factor;}
  if(Math.max(height,width)/Math.min(height,width)>200)throw Error('Image aspect ratio exceeds 200');
  let h=roundEven(height/factor)*factor,w=roundEven(width/factor)*factor;
  if(h*w>maxPixels){const beta=Math.sqrt(height*width/maxPixels);h=Math.floor(height/beta/factor)*factor;w=Math.floor(width/beta/factor)*factor;}
  else if(h*w<minPixels){const beta=Math.sqrt(minPixels/(height*width));h=Math.ceil(height*beta/factor)*factor;w=Math.ceil(width*beta/factor)*factor;}
  if(h<factor||w<factor)throw Error('Image aspect ratio cannot fit the configured pixel budget');
  return {height:h,width:w};
}

function cubic(x){x=Math.abs(x);return x<1?((1.5*x-2.5)*x)*x+1:x<2?((-.5*x+2.5)*x-4)*x+2:0;}
function lanczos(x){x=Math.abs(x);if(x===0)return 1;if(x>=3)return 0;const p=Math.PI*x;return Math.sin(p)/p*Math.sin(p/3)/(p/3);}
function coefficients(input,output,filter){
  const scale=input/output,filterScale=Math.max(1,scale),support=(filter==='lanczos'?3:2)*filterScale,kernel=filter==='lanczos'?lanczos:cubic;
  return Array.from({length:output},(_,i)=>{
    const center=(i+.5)*scale,start=Math.max(0,Math.floor(center-support+.5)),end=Math.min(input,Math.floor(center+support+.5));
    const weights=new Float64Array(end-start);let sum=0;
    for(let j=start;j<end;j++){const weight=kernel((j-center+.5)/filterScale);weights[j-start]=weight;sum+=weight;}
    if(!Number.isFinite(sum)||!sum)throw Error('Invalid resampling weights');
    for(let j=0;j<weights.length;j++)weights[j]/=sum;
    return {start,weights};
  });
}

function resizeRGB(rgb,width,height,newWidth,newHeight,filter,signal){
  if(width===newWidth&&height===newHeight)return rgb;
  let horizontal=rgb;
  if(width!==newWidth){
    const coeff=coefficients(width,newWidth,filter);horizontal=new Uint8Array(newWidth*height*3);
    for(let y=0;y<height;y++){check(signal);for(let x=0;x<newWidth;x++){
      const {start,weights}=coeff[x],target=(y*newWidth+x)*3;
      for(let c=0;c<3;c++){let value=0;for(let k=0;k<weights.length;k++)value+=rgb[(y*width+start+k)*3+c]*weights[k];horizontal[target+c]=byte(value);}
    }}
  }
  if(height===newHeight)return horizontal;
  const coeff=coefficients(height,newHeight,filter),result=new Uint8Array(newWidth*newHeight*3);
  for(let y=0;y<newHeight;y++){check(signal);const {start,weights}=coeff[y];for(let x=0;x<newWidth;x++){
    const target=(y*newWidth+x)*3;
    for(let c=0;c<3;c++){let value=0;for(let k=0;k<weights.length;k++)value+=horizontal[((start+k)*newWidth+x)*3+c]*weights[k];result[target+c]=byte(value);}
  }}
  return result;
}

export function preprocessImageData(image,{task='spotting',minPixels=PADDLE_SPEC.minPixels,
  maxPixels=task==='spotting'?PADDLE_SPEC.spottingMaxPixels:PADDLE_SPEC.maxPixels,
  spottingUpscale=task==='spotting',signal,onProgress}={}){
  const {width:originalWidth,height:originalHeight,data}=image;
  if(!Number.isInteger(originalWidth)||!Number.isInteger(originalHeight)||originalWidth<=0||originalHeight<=0||data.length!==originalWidth*originalHeight*4)throw Error('Expected non-empty RGBA ImageData');
  check(signal);onProgress?.({stage:'pixels'});
  let width=originalWidth,height=originalHeight,rgb=new Uint8Array(width*height*3);
  for(let i=0;i<width*height;i++){
    const alpha=data[i*4+3]/255;
    for(let c=0;c<3;c++)rgb[i*3+c]=byte(data[i*4+c]*alpha+255*(1-alpha));
  }
  // Paddle's spotting helper upsamples small inputs with Lanczos before normal preprocessing.
  if(spottingUpscale&&width<1500&&height<1500){rgb=resizeRGB(rgb,width,height,width*2,height*2,'lanczos',signal);width*=2;height*=2;}
  const resized=smartResize(height,width,{minPixels,maxPixels});onProgress?.({stage:'resize',...resized});
  rgb=resizeRGB(rgb,width,height,resized.width,resized.height,'bicubic',signal);
  width=resized.width;height=resized.height;
  const patch=PADDLE_SPEC.patchSize,gridH=height/patch,gridW=width/patch,count=gridH*gridW,pixelValues=new Float32Array(count*3*patch*patch);
  let offset=0;
  // Do not use Qwen2-VL's 2x2 merge-block patch ordering here. The Paddle processor
  // transposes to (t,grid_h,grid_w,channel,temporal,patch_h,patch_w), i.e. raster order.
  for(let gy=0;gy<gridH;gy++){check(signal);for(let gx=0;gx<gridW;gx++)for(let c=0;c<3;c++)for(let py=0;py<patch;py++)for(let px=0;px<patch;px++){
    pixelValues[offset++]=(rgb[((gy*patch+py)*width+gx*patch+px)*3+c]/255-.5)/.5;
  }}
  const grid=[1,gridH,gridW];onProgress?.({stage:'ready',patches:count});
  // The lbm364dl ONNX vision wrapper adds batch=1 around the official patch tensor.
  return {pixelValues,pixelDims:[1,count,3,patch,patch],grid,imageGridThw:BigInt64Array.from(grid,BigInt),imageGridDims:[1,3],
    imageTokenCount:count/4,resizedWidth:width,resizedHeight:height,originalWidth,originalHeight,
    preprocessing:{task,minPixels,maxPixels,spottingUpscale,resampler:'JS separable bicubic/Lanczos; Pillow byte parity unverified'}};
}

export function preprocessCanvas(canvas,options={}){
  if(!canvas?.width||!canvas?.height)throw Error('Expected a non-empty source canvas');
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('Cannot read source canvas pixels');
  return preprocessImageData(context.getImageData(0,0,canvas.width,canvas.height),options);
}

function gridValues(grid){
  const [t,h,w]=Array.from(grid,Number);
  if(t!==1||![h,w].every(v=>Number.isInteger(v)&&v>0&&v%2===0))throw Error('Only one static image with an even patch grid is supported');
  return [t,h,w];
}
function numericIds(value){
  if(value?.data)value=value.data;
  if(Array.isArray(value)&&Array.isArray(value[0])){if(value.length!==1)throw Error('Only batch size one is supported');value=value[0];}
  const result=Array.from(value||[],Number);
  if(!result.length||!result.every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Tokenizer returned invalid token IDs');
  return result;
}

export function prefillPositionIds(inputIds,grid){
  const ids=numericIds(inputIds),[,h,w]=gridValues(grid),rows=h/2,cols=w/2,imageTokenCount=rows*cols;
  const start=ids.indexOf(PADDLE_SPEC.imageTokenId);
  if(start<1||ids[start-1]!==PADDLE_SPEC.visionStartTokenId||ids[start+imageTokenCount]!==PADDLE_SPEC.visionEndTokenId)throw Error('Image tokens do not match the supplied grid and image boundaries');
  if(ids.filter(id=>id===PADDLE_SPEC.imageTokenId).length!==imageTokenCount||ids.slice(start,start+imageTokenCount).some(id=>id!==PADDLE_SPEC.imageTokenId))throw Error('Image token count/order mismatch');
  const length=ids.length,positions=new BigInt64Array(3*length);
  for(let axis=0;axis<3;axis++)for(let i=0;i<start;i++)positions[axis*length+i]=BigInt(i);
  for(let i=0;i<imageTokenCount;i++){
    positions[start+i]=BigInt(start);
    positions[length+start+i]=BigInt(start+Math.floor(i/cols));
    positions[2*length+start+i]=BigInt(start+i%cols);
  }
  const tail=start+imageTokenCount,tailPosition=start+Math.max(rows,cols);
  for(let axis=0;axis<3;axis++)for(let i=tail;i<length;i++)positions[axis*length+i]=BigInt(tailPosition+i-tail);
  const nextPosition=tailPosition+length-tail,ropeDelta=nextPosition-length;
  return {positionIds:positions,positionDims:[3,1,length],ropeDelta,nextPosition,imageStartIndex:start,imageTokenCount};
}

export async function buildPrompt(tokenizer,grid,{task='spotting'}={}){
  if(!Object.hasOwn(prompts,task))throw Error('Unknown Paddle recognition task');
  const [,h,w]=gridValues(grid),imageTokenCount=h*w/4;
  const prompt='<|begin_of_sentence|>User: <|IMAGE_START|><|IMAGE_PLACEHOLDER|><|IMAGE_END|>'+prompts[task]+'\nAssistant:\n';
  const encoded=typeof tokenizer.encode==='function'?await tokenizer.encode(prompt,{add_special_tokens:false}):await tokenizer(prompt,{add_special_tokens:false,return_tensor:false,padding:false,truncation:false});
  const ids=numericIds(encoded?.input_ids??encoded),where=ids.indexOf(PADDLE_SPEC.imageTokenId);
  if(where<0||ids.filter(id=>id===PADDLE_SPEC.imageTokenId).length!==1)throw Error('Tokenizer must preserve the Paddle image placeholder as token 100295');
  const expanded=[...ids.slice(0,where),...Array(imageTokenCount).fill(PADDLE_SPEC.imageTokenId),...ids.slice(where+1)];
  const inputIds=BigInt64Array.from(expanded,BigInt),length=expanded.length;
  return {prompt,inputIds,inputDims:[1,length],attentionMask:new BigInt64Array(length).fill(1n),attentionDims:[1,length],...prefillPositionIds(inputIds,grid)};
}

// For the first generated token fed back into the decoder, cachedLength is the
// complete prefill sequence length S; its position is S + ropeDelta on all axes.
export function generationPositionIds(cachedLength,newTokenCount,ropeDelta){
  if(![cachedLength,newTokenCount,ropeDelta].every(Number.isSafeInteger)||cachedLength<0||newTokenCount<1||cachedLength+ropeDelta<0)throw Error('Invalid generation positions');
  const positions=new BigInt64Array(3*newTokenCount);
  for(let axis=0;axis<3;axis++)for(let i=0;i<newTokenCount;i++)positions[axis*newTokenCount+i]=BigInt(cachedLength+ropeDelta+i);
  return positions;
}

const locRE=()=>/<\|LOC_(-?\d+(?:\.\d+)?)\|>/g;
const stripEnd=text=>text.replace(/(?:<\/s>|<\|end_of_sentence\|>)\s*$/g,'').trim();
function makeSpot(text,values,index,warnings,tolerance){
  text=text.trim();if(!text||text.length>60000)throw Error('Spotting result has missing or excessive text');
  if(values.length!==8)throw Error('Spotting coordinates must contain exactly four x/y points');
  const coordinates=values.map(Number);let clamped=false;
  for(let i=0;i<coordinates.length;i++){
    const value=coordinates[i];if(!Number.isFinite(value)||value < -tolerance||value>1000+tolerance)throw Error('Spotting coordinate is outside the normalized image');
    if(value<0||value>1000)clamped=true;coordinates[i]=Math.max(0,Math.min(1000,value))/1000;
  }
  const polygon=Array.from({length:4},(_,i)=>coordinates.slice(i*2,i*2+2)),xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1]);
  const box=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  const area=Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%4];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;
  if(box[2]<=box[0]||box[3]<=box[1]||area<=0)throw Error('Spotting returned a degenerate text polygon');
  if(clamped)warnings.push(`Line ${index+1}: a coordinate within the ${tolerance}/1000 tolerance was clamped to the image edge`);
  return {text,box,polygon,separator:'\n',confidence:null,...(clamped?{uncertain:true}:{})};
}

export function parseSpotting(raw,{coordinateTolerance=1}={}){
  if(typeof raw!=='string'||raw.length>1000000)throw Error('Invalid or excessive spotting response');
  if(!Number.isFinite(coordinateTolerance)||coordinateTolerance<0||coordinateTolerance>5)throw Error('Invalid coordinate tolerance');
  raw=stripEnd(raw);const words=[],warnings=[];
  if(!raw)return {text:'',words,confidence:null,source:'paddleocr-vl-1.5',warnings};
  const texts=[...raw.matchAll(/<\|TEXT_START\|>([\s\S]*?)<\|TEXT_END\|>/g)],blocks=[...raw.matchAll(/<\|LOC_BEGIN\|>([\s\S]*?)<\|LOC_END\|>/g)];
  if(texts.length){
    if(texts.length!==blocks.length)throw Error('Spotting response has unmatched text/coordinate blocks');
    for(let i=0;i<texts.length;i++)words.push(makeSpot(texts[i][1],[...blocks[i][1].matchAll(locRE())].map(m=>m[1]),i,warnings,coordinateTolerance));
    const remainder=raw.replace(/<\|TEXT_START\|>[\s\S]*?<\|TEXT_END\|>/g,'').replace(/<\|LOC_BEGIN\|>[\s\S]*?<\|LOC_END\|>/g,'').trim();
    if(remainder)throw Error('Spotting response contains unpositioned or truncated text');
  }else{
    if(/<\|(?:TEXT_START|TEXT_END|LOC_BEGIN|LOC_END)\|>/.test(raw))throw Error('Spotting response has incomplete annotation markers');
    const matches=[...raw.matchAll(locRE())];if(!matches.length||matches.length%8)throw Error('Spotting response has missing or incomplete coordinates');
    let cursor=0;
    for(let i=0;i<matches.length;i+=8){
      const group=matches.slice(i,i+8),last=group.at(-1);
      for(let j=0;j<7;j++)if(raw.slice(group[j].index+group[j][0].length,group[j+1].index).trim())throw Error('Text interrupted a spotting coordinate group');
      words.push(makeSpot(raw.slice(cursor,group[0].index),group.map(m=>m[1]),words.length,warnings,coordinateTolerance));
      cursor=last.index+last[0].length;
    }
    if(raw.slice(cursor).trim())throw Error('Spotting response ends with text without coordinates');
  }
  if(words.length>1500||words.reduce((sum,word)=>sum+word.text.length,0)>60000)throw Error('Spotting response exceeds the page text budget');
  return {text:words.map(word=>word.text).join('\n'),words,confidence:null,source:'paddleocr-vl-1.5',warnings};
}
