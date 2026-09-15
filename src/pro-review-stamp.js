/* Editable review labels and shared display/PDF arrow geometry. No remote assets. */
(()=>{
 'use strict';
 const DEFAULT_COLOR='#e60012',clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const presets=[['revise','수정'],['check','확인'],['review','검토'],['apply','반영'],['typo','오타 수정'],['formula','산식 수정'],['add','내용 추가'],['delete','삭제'],['again','재확인'],['number','수치 확인'],['source','출처 확인'],['page','페이지 확인'],['opinion','의견'],['important','중요'],['supplement','보완'],['done','확인 완료']].map(([id,text])=>({id,text,shape:'rect'}));
 const color=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value.toLowerCase():DEFAULT_COLOR;
 function normalize(review={}){const p=presets.find(p=>p.id===review.preset)||presets[0];return {preset:p.id,text:String(review.text??p.text).replace(/[\r\n\t]+/g,' ').slice(0,30)||p.text,shape:p.shape,color:color(review.color),arrow:review.arrow!==false,tip:{x:Number.isFinite(review.tip?.x)?clamp(review.tip.x,-100,100):.75,y:Number.isFinite(review.tip?.y)?clamp(review.tip.y,-100,100):.48}};}
 function arrow(mark,box,pageWidth,pageHeight){
  const r=normalize(mark.review),pad=Math.min(3,pageWidth/8,pageHeight/8),cx=box.x+box.width/2,cy=box.y+box.height/2;
  const end={x:clamp(cx+r.tip.x*box.width,pad,pageWidth-pad),y:clamp(cy+r.tip.y*box.width,pad,pageHeight-pad)};
  const dx=end.x-cx,dy=end.y-cy,t=1/Math.max(Math.abs(dx)/(box.width/2),Math.abs(dy)/(box.height/2),.0001);
  if(!r.arrow||t>=1)return {end,curves:[],head:[],width:0};
  const start={x:cx+dx*t,y:cy+dy*t},distance=Math.hypot(end.x-start.x,end.y-start.y);
  const at=f=>({x:start.x+(end.x-start.x)*f,y:start.y+(end.y-start.y)*f});
  // Collinear controls keep the shared preview/PDF geometry API compatible.
  const curves=[[start,at(1/3),at(2/3),end]];
  const a=Math.atan2(end.y-start.y,end.x-start.x),headLength=Math.min(box.width*.075,distance*.32),point=sign=>({x:clamp(end.x-headLength*Math.cos(a+sign*.5),pad,pageWidth-pad),y:clamp(end.y-headLength*Math.sin(a+sign*.5),pad,pageHeight-pad)});
  return {end,curves,head:[point(-1),end,point(1)],width:Math.max(.7,box.width*.010)};
 }
 const point=p=>`${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
 function path(g){return {curve:g.curves.map(c=>`M ${point(c[0])} L ${point(c[3])}`).join(' '),head:g.head.length?`M ${g.head.map(point).join(' L ')}`:''};}
 function tipAt(box,x,y,w,h){return {x:(clamp(x,3,w-3)-box.x-box.width/2)/box.width,y:(clamp(y,3,h-3)-box.y-box.height/2)/box.width};}
 async function render(review){
  const r=normalize(review);await PDFMarkupText.load('gothic');
  const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=320;const c=canvas.getContext('2d');
  c.strokeStyle=r.color;c.fillStyle=r.color;c.lineWidth=8;c.lineJoin='round';c.lineCap='round';
  c.beginPath();c.roundRect(16,24,968,272,12);c.stroke();
  const maxWidth=820;let size=120;c.font=`700 ${size}px PDFStudioGothic`;
  size=Math.min(size,size*maxWidth/Math.max(1,c.measureText(r.text).width));c.font=`700 ${size}px PDFStudioGothic`;c.textAlign='center';c.textBaseline='middle';c.fillText(r.text,500,164);
  const data=canvas.toDataURL('image/png');canvas.width=canvas.height=0;return {data,ratio:1000/320,name:r.text,review:r};
 }
 function drawPdf(page,mark,box,w,h,b,rotation,userUnit){
  if(!mark.review)return;const P=globalThis.PDFLib,g=arrow(mark,box,w,h);if(!g.curves.length)return;
  const rgb=color(mark.review.color),ink=P.rgb(parseInt(rgb.slice(1,3),16)/255,parseInt(rgb.slice(3,5),16)/255,parseInt(rgb.slice(5,7),16)/255),to=p=>globalThis.PDFProDocument.displayToPdf(p.x/userUnit,p.y/userUnit,b,rotation);
  // drawSvgPath establishes opacity safely, while explicit PDF paths preserve
  // the shared curve for rotated CropBoxes and non-default UserUnit values.
  const encoded=path({curves:g.curves.map(c=>c.map(p=>{const [x,y]=to(p);return {x,y:-y};})),head:g.head.map(p=>{const [x,y]=to(p);return {x,y:-y};})});
  for(const d of [encoded.curve,encoded.head])page.drawSvgPath(d,{x:0,y:0,borderColor:ink,borderWidth:g.width/userUnit,borderOpacity:mark.opacity,borderLineCap:P.LineCapStyle.Round});
 }
 async function png(mark){
  const box={x:150000,y:150000,width:1000,height:1000/mark.ratio},g=arrow(mark,box,300000,300000);
  const points=[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y+box.height},...g.curves.flat(),...g.head],xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const x=Math.min(...xs)-20,y=Math.min(...ys)-20,w=Math.max(...xs)-x+20,h=Math.max(...ys)-y+20,scale=Math.min(1,2048/Math.max(w,h));
  const c=document.createElement('canvas');c.width=Math.ceil(w*scale);c.height=Math.ceil(h*scale);const ctx=c.getContext('2d'),img=new Image();img.src=mark.data;await img.decode();ctx.scale(scale,scale);ctx.translate(-x,-y);ctx.drawImage(img,box.x,box.y,box.width,box.height);
  ctx.strokeStyle=color(mark.review.color);ctx.lineWidth=g.width;ctx.lineCap='round';ctx.lineJoin='round';for(const d of Object.values(path(g)))if(d)ctx.stroke(new Path2D(d));
  const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));c.width=c.height=0;if(!blob)throw Error('PNG를 만들지 못했습니다.');return blob;
 }
 globalThis.PDFReviewStamp={DEFAULT_COLOR,presets,normalize,color,arrow,path,tipAt,render,drawPdf,png};
 if(typeof module!=='undefined')module.exports=globalThis.PDFReviewStamp;
})();
