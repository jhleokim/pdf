const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const S=require('../src/pro-review-stamp.js');
test('review stamps provide the requested red presets and normalize editable metadata',()=>{
 assert.equal(S.presets.length,16);assert.equal(S.normalize().color,'#e60012');assert.equal(S.normalize({color:'#0077BB'}).color,'#0077bb');assert.equal(S.normalize({color:'url(x)'}).color,S.DEFAULT_COLOR);
 assert.equal(S.normalize({text:'a\nb',arrow:false}).text,'a b');assert.equal(S.normalize({arrow:false}).arrow,false);assert.equal(S.normalize({tip:{x:Infinity,y:NaN}}).tip.x,.75);
});
test('arrow tip moves independently of the label and stays inside every page edge',()=>{
 const box={x:100,y:150,width:120,height:38};
 for(const x of[-500,0,140,290,900])for(const y of[-500,0,210,490,900]){
  const tip=S.tipAt(box,x,y,300,500),g=S.arrow({review:{tip}},box,300,500);
  assert.ok(Math.abs(g.end.x-Math.max(3,Math.min(297,x)))<1e-10);assert.ok(Math.abs(g.end.y-Math.max(3,Math.min(497,y)))<1e-10);
  for(const p of [...g.curves.flat(),...g.head])assert.ok(p.x>=3&&p.x<=297&&p.y>=3&&p.y<=497);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(S.path(g))));
 }
 assert.deepEqual(S.arrow({review:{arrow:false}},box,300,500).curves,[]);assert.deepEqual(S.arrow({review:{tip:{x:0,y:0}}},box,300,500).curves,[]);
});
const root=path.resolve(__dirname,'..'),scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const canvas=(()=>{for(const name of['@napi-rs/canvas',path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')])try{return require(name);}catch{}})();
const ctx=vm.createContext({console:{log(){},warn(){},error:console.error},setTimeout,clearTimeout,TextEncoder,TextDecoder,URL,URLSearchParams,Blob,ReadableStream,WritableStream,TransformStream,AbortController,AbortSignal,atob,btoa,DOMException,ArrayBuffer,Uint8Array,Uint8ClampedArray,Int8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,DataView,assert});
for(const marker of['sourceMappingURL=pdf-lib.min.js.map','pdfjs-dist/build/pdf"]','pdfjs-dist/build/pdf.worker'])vm.runInContext(scripts.find(s=>s.includes(marker)),ctx);
for(const name of['pro-document','pro-review-stamp','pro-stamp'])vm.runInContext(fs.readFileSync(path.join(root,'src',name+'.js'),'utf8'),ctx);
test('PDF arrow matches interactive curve in every direction, with rotated offset CropBoxes and UserUnit',{skip:!canvas},async()=>{
 Object.assign(ctx,{DOMMatrix:canvas.DOMMatrix,Path2D:canvas.Path2D,ImageData:canvas.ImageData,document:{createElement:()=>canvas.createCanvas(1,1)},makeCanvas:canvas.createCanvas});
 await vm.runInContext(`(async()=>{
 const P=PDFLib,S=PDFReviewStamp,G=PDFProDocument;
 for(const rotation of[0,90,180,270])for(const unit of[1,2])for(const tip of[{x:.8,y:.55},{x:-.8,y:.55},{x:.8,y:-.55},{x:-.8,y:-.55}]){
  const doc=await P.PDFDocument.create(),page=doc.addPage([420,620]);page.setCropBox(20,30,360,540);page.setRotation(P.degrees(rotation));page.node.set(P.PDFName.of('UserUnit'),P.PDFNumber.of(unit));
  const b=G.visibleBox(page),w=(rotation%180?b.height:b.width)*unit,h=(rotation%180?b.width:b.height)*unit;
  const mark={width:40,ratio:3.125,anchor:'top-left',x:w*.4*25.4/72,y:h*.4*25.4/72,opacity:1,review:{color:'#e60012',tip}},box=PDFStamp.placement(mark,w,h),g=S.arrow(mark,box,w,h);
  S.drawPdf(page,mark,box,w,h,b,rotation,unit);
  const task=pdfjsLib.getDocument({data:await doc.save(),verbosity:0});try{const pdf=await task.promise,p=await pdf.getPage(1),vp=p.getViewport({scale:1}),c=makeCanvas(Math.ceil(vp.width),Math.ceil(vp.height));await p.render({canvasContext:c.getContext('2d'),viewport:vp,background:'white'}).promise;
   const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   function near(p){const x=p.x/unit,y=p.y/unit;for(let yy=Math.max(0,Math.floor(y)-3);yy<=Math.min(c.height-1,Math.ceil(y)+3);yy++)for(let xx=Math.max(0,Math.floor(x)-3);xx<=Math.min(c.width-1,Math.ceil(x)+3);xx++){const i=(yy*c.width+xx)*4;if(pixels[i]>140&&pixels[i+1]<100&&pixels[i+2]<100)return true;}return false;}
   for(const points of g.curves)for(const t of[.1,.3,.5,.7,.9]){const q=1-t,p={x:q*q*q*points[0].x+3*q*q*t*points[1].x+3*q*t*t*points[2].x+t*t*t*points[3].x,y:q*q*q*points[0].y+3*q*q*t*points[1].y+3*q*t*t*points[2].y+t*t*t*points[3].y};assert.ok(near(p),JSON.stringify({rotation,unit,tip,t,p}));}
   for(const p of g.head)assert.ok(near(p),'Arrowhead follows the terminal tangent');
  }finally{await task.destroy();}
 }
})()`,ctx);
});
test('stamp PDF placement applies editable arrows only to selected page UIDs and preserves source text',{skip:!canvas},async()=>{
 ctx.png=canvas.createCanvas(2,2).toDataURL('image/png');
 await vm.runInContext(`(async()=>{const P=PDFLib,doc=await P.PDFDocument.create();for(let i=0;i<3;i++){const p=doc.addPage([400,600]);p.drawText('Original '+i,{x:40,y:500,size:12});}
 const mark={data:png,ratio:3.125,width:40,x:30,y:40,anchor:'top-left',opacity:.5,scope:'selected',targets:['b'],review:PDFReviewStamp.normalize()};assert.equal(await PDFStamp.apply(doc,[mark],{pageIds:['a','b','c']}),1);
 const task=pdfjsLib.getDocument({data:await doc.save(),verbosity:0});try{const pdf=await task.promise;for(let i=1;i<=3;i++){const p=await pdf.getPage(i),text=await p.getTextContent();assert.ok(text.items.some(x=>x.str==='Original '+(i-1)));const ops=await p.getOperatorList();assert.equal(ops.fnArray.filter(n=>n===pdfjsLib.OPS.paintImageXObject).length,i===2?1:0);}}finally{await task.destroy();}
})()`,ctx);
});
