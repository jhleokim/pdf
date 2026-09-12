/* Experimental browser adapter for official PaddlePaddle PP-OCRv5 ONNX models.
   DB detection + rotated-rectangle expansion + perspective crops + CTC decoding.
   References: PaddleOCR ppocr/postprocess/db_postprocess.py and tools/infer/predict_rec.py (Apache-2.0).
   No cloud calls or document persistence. Line boxes, not per-character geometry. */
function ppv5ReadingOrder(words){
 const row=(a,b)=>{const overlap=Math.min(a.box[3],b.box[3])-Math.max(a.box[1],b.box[1]);return overlap>Math.min(a.box[3]-a.box[1],b.box[3]-b.box[1])*.5?a.box[0]-b.box[0]:a.box[1]-b.box[1];};
 const body=words.filter(w=>w.text.length>=12&&w.box[2]-w.box[0]>.15);
 if(body.length<20)return {words:[...words].sort(row),columns:1};
 let best=null;
 for(let split=.4;split<=.6001;split+=.01){
  const left=words.filter(w=>w.box[2]<=split-.008),right=words.filter(w=>w.box[0]>=split+.008),cross=words.length-left.length-right.length;
  if(left.length<10||right.length<10||cross>words.length*.22||body.filter(w=>w.box[2]<split).length<8||body.filter(w=>w.box[0]>split).length<8)continue;
  const score=cross+Math.abs(split-.5);if(!best||score<best.score)best={split,score};
 }
 if(!best)return {words:[...words].sort(row),columns:1};
 const split=best.split,spans=words.filter(w=>w.box[0]<split-.008&&w.box[2]>split+.008).sort(row),remaining=new Set(words),out=[];
 function flush(y){const group=[...remaining].filter(w=>(w.box[1]+w.box[3])/2<y);for(const w of group)remaining.delete(w);out.push(...group.filter(w=>(w.box[0]+w.box[2])/2<split).sort(row),...group.filter(w=>(w.box[0]+w.box[2])/2>=split).sort(row));}
 for(const span of spans){if(!remaining.has(span))continue;flush((span.box[1]+span.box[3])/2);remaining.delete(span);out.push(span);}
 flush(Infinity);return {words:out,columns:2};
}
async function createPPV5({asset=async name=>new Uint8Array(await(await fetch(name)).arrayBuffer()),dict,signal,onProgress=()=>{}}={}){
 const check=()=>signal?.throwIfAborted();check();
 ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
 const cvReady=cv;
 if(typeof cvReady.then==='function')await new Promise(resolve=>cvReady.then(()=>resolve()));
 else if(!cvReady.Mat)await new Promise(resolve=>cvReady.onRuntimeInitialized=resolve);
 const C=cvReady;onProgress('모델 준비');
 const det=await ort.InferenceSession.create(await asset('det.onnx'),{executionProviders:['wasm']}),rec=await ort.InferenceSession.create(await asset('rec.onnx'),{executionProviders:['wasm']});
 if(!dict)dict=JSON.parse(new TextDecoder().decode(await asset('dict.json')));
 const canvas=(w,h)=>new OffscreenCanvas(w,h);
 function tensor(c,kind,width=c.width){
  const {data}=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height),v=new Float32Array(3*c.height*width),mean=[.485,.456,.406],std=[.229,.224,.225];
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)for(let k=0;k<3;k++){
   const n=data[(y*c.width+x)*4+2-k]/255;v[k*c.height*width+y*width+x]=kind==='det'?(n-mean[k])/std[k]:(n-.5)/.5;
  }
  return new ort.Tensor('float32',v,[1,3,c.height,width]);
 }
 const corners=rect=>C.RotatedRect.points(rect).map(p=>[p.x,p.y]);
 function order(points){const s=[...points].sort((a,b)=>a[0]-b[0]),left=s.slice(0,2).sort((a,b)=>a[1]-b[1]),right=s.slice(2).sort((a,b)=>a[1]-b[1]);return [left[0],right[0],right[1],left[1]];}
 function scoreBox(prob,w,h,p){
  let sum=0,count=0;const x0=Math.max(0,Math.floor(Math.min(...p.map(v=>v[0])))),x1=Math.min(w-1,Math.ceil(Math.max(...p.map(v=>v[0])))),y0=Math.max(0,Math.floor(Math.min(...p.map(v=>v[1])))),y1=Math.min(h-1,Math.ceil(Math.max(...p.map(v=>v[1]))));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   let positive=false,negative=false;for(let i=0;i<4;i++){const a=p[i],b=p[(i+1)%4],cross=(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);positive ||= cross>0;negative ||= cross<0;}
   if(!(positive&&negative)){sum+=prob[y*w+x];count++;}
  }return count?sum/count:0;
 }
 function boxes(prob,w,h,ow,oh){
  const mask=new C.Mat(h,w,C.CV_8UC1),contours=new C.MatVector(),hier=new C.Mat(),out=[];
  try{
   for(let i=0;i<w*h;i++)mask.data[i]=prob[i]>.3?255:0;
   C.findContours(mask,contours,hier,C.RETR_LIST,C.CHAIN_APPROX_SIMPLE);
   for(let i=0;i<Math.min(1000,contours.size());i++){
    const contour=contours.get(i);try{
     const r=C.minAreaRect(contour);if(Math.min(r.size.width,r.size.height)<3)continue;
     const poly=order(corners(r)),confidence=scoreBox(prob,w,h,poly);if(confidence<.6)continue;
     // For a minimum-area rectangle, the enclosing rectangle of its rounded
     // polygon offset grows each side by 2*area*ratio/perimeter.
     const d=r.size.width*r.size.height*1.5/(2*(r.size.width+r.size.height));
     r.size.width+=2*d;r.size.height+=2*d;if(Math.min(r.size.width,r.size.height)<5)continue;
     const quad=order(corners(r)).map(([x,y])=>[Math.max(0,Math.min(ow-1,Math.round(x/w*ow))),Math.max(0,Math.min(oh-1,Math.round(y/h*oh)))]);
     out.push({quad,detectionConfidence:confidence});
    }finally{contour.delete();}
   }
  }finally{mask.delete();contours.delete();hier.delete();}
  return out.sort((a,b)=>a.quad[0][1]-b.quad[0][1]||a.quad[0][0]-b.quad[0][0]);
 }
 function crop(src,quad){
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const w=Math.max(1,Math.round(Math.max(distance(quad[0],quad[1]),distance(quad[2],quad[3])))),h=Math.max(1,Math.round(Math.max(distance(quad[0],quad[3]),distance(quad[1],quad[2]))));
  const from=C.matFromArray(4,1,C.CV_32FC2,quad.flat()),to=C.matFromArray(4,1,C.CV_32FC2,[0,0,w,0,w,h,0,h]),matrix=C.getPerspectiveTransform(from,to),dst=new C.Mat();
  try{C.warpPerspective(src,dst,matrix,new C.Size(w,h),C.INTER_CUBIC,C.BORDER_REPLICATE);
   if(h/w>=1.5)C.rotate(dst,dst,C.ROTATE_90_COUNTERCLOCKWISE);
   const c=canvas(dst.cols,dst.rows);c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(dst.data),dst.cols,dst.rows),0,0);return c;
  }finally{from.delete();to.delete();matrix.delete();dst.delete();}
 }
 function decode(t,batchIndex=0){
  const [batch,steps,chars]=t.dims;if(batchIndex>=batch||chars!==dict.length)throw Error('문자 사전 크기 불일치: '+chars+' / '+dict.length);
  let previous=0,text='',sum=0,count=0;
  for(let i=0;i<steps;i++){let best=0,value=-Infinity;for(let j=0;j<chars;j++)if(t.data[(batchIndex*steps+i)*chars+j]>value){best=j;value=t.data[(batchIndex*steps+i)*chars+j];}
   if(best!==0&&best!==previous){text+=dict[best];sum+=value;count++;}previous=best;
  }return {text:text.normalize('NFC'),confidence:count?sum/count:0};
 }
 return {async recognize(original,{size=1536}={}){
  check();const started=performance.now(),ratio=size/Math.max(original.width,original.height),w=Math.max(32,Math.round(original.width*ratio/32)*32),h=Math.max(32,Math.round(original.height*ratio/32)*32),input=canvas(w,h);
  input.getContext('2d').drawImage(original,0,0,w,h);onProgress('글자 영역 탐지');let feed=tensor(input,'det'),output;
  try{output=await det.run({[det.inputNames[0]]:feed});}finally{feed.dispose();}
  check();const map=output[det.outputNames[0]],found=boxes(map.data,map.dims.at(-1),map.dims.at(-2),original.width,original.height);for(const t of Object.values(output))t.dispose();input.width=input.height=0;
  const detectedAt=performance.now(),src=C.matFromImageData(original.getContext('2d').getImageData(0,0,original.width,original.height)),words=[];
  try{
   const work=found.map((item,index)=>({...item,index,ratio:Math.hypot(item.quad[1][0]-item.quad[0][0],item.quad[1][1]-item.quad[0][1])/Math.max(1,Math.hypot(item.quad[3][0]-item.quad[0][0],item.quad[3][1]-item.quad[0][1]))})).sort((a,b)=>a.ratio-b.ratio);
   for(let i=0;i<work.length;i+=4){
    check();onProgress('글줄 인식 '+Math.min(i+4,work.length)+' / '+work.length,i/work.length);
    const group=work.slice(i,i+4),parts=group.map(item=>crop(src,item.quad)),widths=parts.map(part=>Math.max(1,Math.ceil(48*part.width/part.height))),width=Math.max(320,...widths);
    if(width>3200)throw Error('너무 긴 글줄: 3200px 제한');
    const buffer=new Float32Array(group.length*3*48*width);
    for(let j=0;j<parts.length;j++){
     const resized=canvas(widths[j],48);resized.getContext('2d').drawImage(parts[j],0,0,widths[j],48);parts[j].width=parts[j].height=0;
     const sample=tensor(resized,'rec',width);buffer.set(sample.data,j*3*48*width);sample.dispose();resized.width=resized.height=0;
    }
    feed=new ort.Tensor('float32',buffer,[group.length,3,48,width]);
    try{output=await rec.run({[rec.inputNames[0]]:feed});}finally{feed.dispose();}
    for(let j=0;j<group.length;j++){
     const item=group[j],result=decode(output[rec.outputNames[0]],j);
     if(result.text.trim())words.push({...item,...result,box:[Math.min(...item.quad.map(p=>p[0]))/original.width,Math.min(...item.quad.map(p=>p[1]))/original.height,Math.max(...item.quad.map(p=>p[0]))/original.width,Math.max(...item.quad.map(p=>p[1]))/original.height]});
    }
    for(const t of Object.values(output))t.dispose();
    await new Promise(r=>setTimeout(r,0));
   }
   words.sort((a,b)=>a.index-b.index);
  }finally{src.delete();}
  const ordered=ppv5ReadingOrder(words);
  return {words:ordered.words,text:ordered.words.map(w=>w.text).join('\n'),columns:ordered.columns,detected:found.length,elapsedMs:performance.now()-started,detectMs:detectedAt-started,width:original.width,height:original.height,detSize:[w,h],backend:'wasm-single-thread',source:'PP-OCRv5 official ONNX Korean mobile',geometry:'line quadrilateral; heuristic column order'};
 },async close(){await det.release();await rec.release();}};
}
