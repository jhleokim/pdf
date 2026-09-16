// Synthetic Vision response: exercises server/client normalization and table export
// without an API key, a network request, or a personal document.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function token(text,x,y,width=35,height=30){
  return {symbols:[...text].map(text=>({text})),confidence:.99,
    boundingBox:{vertices:[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}]}};
}
function paragraph(words){
  words.at(-1).symbols.at(-1).property={detectedBreak:{type:'LINE_BREAK'}};
  return {words};
}
function responseFixture(){
  const paragraphs=[
    paragraph([token('금액',80,100,60),token('(',141,100,8),token('원',150,100,30),token(')',181,100,8)]),
    paragraph([token('계약일',550,100,90)]),
    paragraph([token('1',80,260,20),token(',',101,288,5,8),token('250',107,260,60),token(',',168,288,5,8),token('000',174,260,60)]),
    paragraph([token('2026',550,260,80),token('-',631,274,10,3),token('09',642,260,40),token('-',683,274,10,3),token('14',694,260,40)]),
    paragraph([token('-',80,474,10,3),token('50',91,460,40),token(',',132,488,5,8),token('000',138,460,60)])
  ];
  return {responses:[{fullTextAnnotation:{text:'금액(원)\n계약일\n1,250,000\n2026-09-14\n-50,000\n',pages:[{width:1000,height:1000,blocks:[{paragraphs}]}]}}]};
}

test('Vision words preserve financial punctuation through server, browser, cells, and TSV',async()=>{
  const raw=responseFixture(),before=structuredClone(raw);let requests=0;
  const {createWorker}=await import('../server/worker.mjs');
  const worker=createWorker(async()=>{requests++;return Response.json(raw);});
  const env={GOOGLE_VISION_API_KEY:'synthetic-key',OCR_RATE_LIMIT:{limit:async()=>({success:true})}};
  class Reader{readAsDataURL(){this.result='data:image/jpeg;base64,/9j/AAAAAAAAAAAA';queueMicrotask(()=>this.onload());}abort(){this.onabort?.();}}
  const context=vm.createContext({URL,AbortController,DOMException,Uint8Array,TextDecoder,Date,setTimeout,clearTimeout,FileReader:Reader,
    location:{protocol:'https:',href:'https://pdf.test/'},
    fetch:(url,init)=>worker.fetch(new Request(url,init),env)});
  for(const file of ['pro-gemini.js','pro-vision-result.js','pro-vision.js','ocr-tables.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context);
  const session=await context.PDFVision.session('kor+eng',new AbortController().signal,null,true);
  const record=await session.recognize({width:1000,height:1000,toBlob:cb=>queueMicrotask(()=>cb(new Blob([Buffer.from('/9j/AAAAAAAAAAAA','base64')],{type:'image/jpeg'})))});
  await session.close();
  assert.equal(requests,1);assert.equal(record.source,'vision');assert.equal(record.words.length,19);
  const sourceWords=JSON.stringify(record.words);
  const table=context.PDFOCRTables.fromGrid({x:[.05,.5,.95],y:[.05,.2,.4,.6],words:record.words});
  assert.deepEqual(Array.from(table.cells,c=>c.text),['금액(원)','계약일','1,250,000','2026-09-14','-50,000','']);
  assert.equal(table.unassignedIndices.length,0);
  table.reviewed=true;
  assert.equal(context.PDFOCRTables.toTSV(table),'금액(원)\t계약일\r\n1,250,000\t2026-09-14\r\n-50,000\t');
  assert.match(context.PDFOCRTables.toHTML(table),/>1,250,000<\/td>/);
  assert.equal(JSON.stringify(record.words),sourceWords);assert.deepEqual(raw,before);
});
