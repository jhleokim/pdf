const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../src/privacy-detect.js'),fixtures=require('./data/privacy-ocr-layout-synthetic.json');
const settings=style=>({types:api.TYPES.map(t=>t.id),style}),contains=(b,x,y)=>b[0]<=x&&b[1]<=y&&b[2]>=x&&b[3]>=y;
const find=(name,page=1)=>fixtures.pages.find(p=>p.fixture===name&&p.page===page).record;

test('bounded ink margins include the actual Vision email descender and right-edge pixels previously exposed',()=>{
 const c=api.detect(find('baseline-vision'),settings('full')).find(c=>c.type==='email');
 assert.ok(c.boxes.some(b=>contains(b,341.875/595,269.375/842)));assert.ok(c.boxes.some(b=>contains(b,135.375/595,280.875/842)));
 const original=find('baseline-vision').words[c.wordIndices[0]].box,b=c.boxes[0];
 assert.ok(original[0]-b[0]<=.00201&&b[2]-original[2]<=.00201&&original[1]-b[1]<=.00151&&b[3]-original[3]<=.00151);
});

test('standard-font fallback covers the previously exposed Paddle card strokes without consuming its label',()=>{
 for(const style of ['full','partial']){
  const c=api.detect(find('baseline-paddle'),settings(style)).find(c=>c.type==='card');
  const point=style==='full'?[94.625/595,334.875/842]:[141.125/595,331.625/842];
  assert.ok(c.boxes.some(b=>contains(b,...point)));assert.ok(c.boxes.every(b=>b[0]>89/595));
 }
});

test('the fallback matches independent Helvetica advances across variable-width ASCII, not a fixed character count',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),ctx=vm.createContext({setTimeout});
 const scripts=[...fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
 vm.runInContext(scripts.map(m=>m[1]).find(s=>s.includes('.PDFLib=')),ctx);
 const doc=await ctx.PDFLib.PDFDocument.create(),font=await doc.embedFont(ctx.PDFLib.StandardFonts.Helvetica);
 const measure=text=>[...text].reduce((sum,char)=>sum+font.widthOfTextAtSize(char,1000),0);
 for(const prefix of ['WWW / iii: ','AV.TTo (Reference): ','0123456789 +-=!? ', 'MIXED_case [x]: ']){
  const record={words:[{text:prefix+'sample+Test@domain.example',box:[.05,.2,.95,.23],separator:'\n'}]};
  for(const style of ['full','partial']){
   const fallback=api.detect(record,settings(style)),measured=api.detect(record,settings(style),measure);assert.equal(fallback.length,1);
   fallback[0].boxes.flat().forEach((value,i)=>assert.ok(Math.abs(value-measured[0].boxes.flat()[i])<1e-10));
  }
 }
});

test('partial masks preserve directly adjacent letters and use separator whitespace instead of the next digit',()=>{
 const record={words:[{text:'성명: 홍길동',box:[.1,.2,.31,.23],separator:'\n'}]};
 const c=api.detect(record,settings('partial'),s=>s.length).find(c=>c.type==='name');assert.ok(c);assert.ok(Math.abs(c.boxes[0][0]-.25)<1e-12);assert.ok(Math.abs(c.boxes[0][2]-.28)<1e-12);
 const phone=api.detect({words:[{text:'010-1234-5678',box:[.1,.4,.7,.43],separator:'\n'}]},settings('partial'),s=>s.length)[0];
 assert.equal(phone.maskedText,'010-****-5678');assert.ok(phone.boxes[0][0]>.25&&phone.boxes[0][2]<.55,'the preserved prefix and suffix are outside the mask');
});

test('quad slicing follows the selected segment of a tilted line instead of its full enclosing height',()=>{
 const text='long.prefix@example.com',quad=[[.1,.2],[.8,.1],[.8,.14],[.1,.24]],record={source:'paddle-v5',granularity:'line',words:[{text,box:[.1,.1,.8,.24],quad,separator:'\n'}]};
 const c=api.detect(record,settings('partial'),s=>s.length)[0],b=c.boxes[0];
 assert.ok(b[1]>.14&&b[3]<.24);assert.ok(b[0]>.1&&b[2]<.8);assert.equal(c.approximate,true);
});

test('padding is clamped to the page and cannot reach a neighboring public label',()=>{
 const record={words:[{text:'PUBLIC',box:[0,.1,.099,.13],separator:' '},{text:'900101-1234567',box:[.1,.1,1,.13],separator:'\n'}]};
 const c=api.detect(record,settings('full'))[0],b=c.boxes[0];assert.ok(b[0]>.099);assert.equal(b[2],1);
 const atEdge=api.detect({words:[{text:'900101-1234567',box:[0,0,.2,.02],separator:'\n'}]},settings('full'))[0].boxes[0];assert.equal(atEdge[0],0);assert.equal(atEdge[1],0);
});
