/* Editable review labels and shared display/PDF arrow geometry. No remote assets. */
(()=>{
 'use strict';
 const DEFAULT_COLOR='#e60012',clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const presets=[['revise','수정해주세요','rect'],['check','확인해주세요','oval'],['review','검토해주세요','rect'],['apply','반영해주세요','rect'],['typo','오타수정','rect'],['formula','산식수정','rect'],['add','내용추가','cloud'],['delete','삭제해주세요','rect'],['again','다시 확인해주세요','rect'],['number','수치 확인','rect'],['source','출처를 확인해주세요','rect'],['page','페이지 확인','rect'],['opinion','의견','cloud'],['important','중요','oval'],['supplement','보완 필요','oval'],['done','확인완료','rect']].map(([id,text,shape])=>({id,text,shape}));
 const color=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value.toLowerCase():DEFAULT_COLOR;
 function normalize(review={}){const p=presets.find(p=>p.id===review.preset)||presets[0];return {preset:p.id,text:String(review.text??p.text).replace(/[\r\n\t]+/g,' ').slice(0,30)||p.text,shape:p.shape,color:color(review.color),arrow:review.arrow!==false,tip:{x:Number.isFinite(review.tip?.x)?clamp(review.tip.x,-100,100):.75,y:Number.isFinite(review.tip?.y)?clamp(review.tip.y,-100,100):.48}};}
 function arrow(mark,box,pageWidth,pageHeight){
  const r=normalize(mark.review),pad=Math.min(3,pageWidth/8,pageHeight/8),cx=box.x+box.width/2,cy=box.y+box.height/2;
  const end={x:clamp(cx+r.tip.x*box.width,pad,pageWidth-pad),y:clamp(cy+r.tip.y*box.width,pad,pageHeight-pad)};
  const dx=end.x-cx,dy=end.y-cy,t=1/Math.max(Math.abs(dx)/(box.width/2),Math.abs(dy)/(box.height/2),.0001);
  if(!r.arrow||t>=1)return {end,curves:[],head:[],width:0};
  const start={x:cx+dx*t,y:cy+dy*t},distance=Math.hypot(end.x-start.x,end.y-start.y),u={x:(end.x-start.x)/distance,y:(end.y-start.y)/distance},v={x:-u.y,y:u.x};
  const bend=Math.min(box.width*.35,distance*.65),at=(along,across)=>({x:clamp(start.x+u.x*along+v.x*across,pad,pageWidth-pad),y:clamp(start.y+u.y*along+v.y*across,pad,pageHeight-pad)});
  // A two-turn trochoid with matching tangents gives smooth open spring coils.
  const curves=[],omega=4*Math.PI,reach=distance*.82,a0=Math.min(box.width*.13,distance*.11),b0=bend*.6;
  const position=t=>[reach*t+a0*Math.sin(omega*t),b0*(1-Math.cos(omega*t))],tangent=t=>[reach+a0*omega*Math.cos(omega*t),b0*omega*Math.sin(omega*t)];
  for(let i=0;i<8;i++){const t=i/8,q=(i+1)/8,p=position(t),n=position(q),d=tangent(t),v=tangent(q);curves.push([at(...p),at(p[0]+d[0]/24,p[1]+d[1]/24),at(n[0]-v[0]/24,n[1]-v[1]/24),at(...n)]);}
  curves.push([at(reach,0),at(distance*.9,0),at(distance*.95,0),end]);
  const c4=curves.at(-1)[2];
  const a=Math.atan2(end.y-c4.y,end.x-c4.x),headLength=Math.min(box.width*.105,distance*.32),point=sign=>({x:clamp(end.x-headLength*Math.cos(a+sign*.55),pad,pageWidth-pad),y:clamp(end.y-headLength*Math.sin(a+sign*.55),pad,pageHeight-pad)});
  return {end,curves,head:[point(-1),end,point(1)],width:Math.max(.7,box.width*.018)};
 }
 const point=p=>`${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
 function path(g){return {curve:g.curves.map((c,i)=>`${i?'':`M ${point(c[0])} `}C ${c.slice(1).map(point).join(' ')}`).join(' '),head:g.head.length?`M ${g.head.map(point).join(' L ')}`:''};}
 function tipAt(box,x,y,w,h){return {x:(clamp(x,3,w-3)-box.x-box.width/2)/box.width,y:(clamp(y,3,h-3)-box.y-box.height/2)/box.width};}
 async function render(review){
  const r=normalize(review);await PDFMarkupText.load('gothic');
  const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=320;const c=canvas.getContext('2d');
  c.strokeStyle=r.color;c.fillStyle=r.color;c.lineWidth=13;c.lineJoin='round';c.lineCap='round';
  if(r.shape==='oval'){c.beginPath();c.ellipse(500,175,460,115,0,0,Math.PI*2);if(r.preset==='check'||r.preset==='supplement')c.setLineDash([30,23]);c.stroke();c.setLineDash([]);if(r.preset==='important'){c.beginPath();c.ellipse(500,175,438,96,-.035,0,Math.PI*2);c.lineWidth=6;c.stroke();c.lineWidth=13;}}
  else if(r.shape==='cloud'){c.beginPath();c.moveTo(98,86);c.bezierCurveTo(126,37,203,41,234,69);c.bezierCurveTo(280,30,349,32,392,66);c.bezierCurveTo(446,31,519,38,558,66);c.bezierCurveTo(621,32,693,35,736,70);c.bezierCurveTo(800,38,870,57,884,93);c.bezierCurveTo(972,92,988,164,944,202);c.bezierCurveTo(975,259,906,304,842,278);c.bezierCurveTo(785,317,707,300,675,279);c.bezierCurveTo(610,316,540,302,498,280);c.bezierCurveTo(435,313,362,307,322,278);c.bezierCurveTo(245,309,179,305,146,274);c.bezierCurveTo(62,309,16,247,54,197);c.bezierCurveTo(13,147,30,89,98,86);c.stroke();}
  else{c.beginPath();c.roundRect(38,62,924,230,46);c.stroke();}
  c.beginPath();c.moveTo(67,33);c.lineTo(43,11);c.moveTo(119,26);c.lineTo(112,5);c.stroke();
  const maxWidth=r.preset==='done'?700:820;let size=112;c.font=`700 ${size}px PDFStudioGothic`;
  size=Math.min(size,size*maxWidth/Math.max(1,c.measureText(r.text).width));c.font=`700 ${size}px PDFStudioGothic`;c.textAlign='center';c.textBaseline='middle';c.fillText(r.text,r.preset==='done'?555:500,180);c.lineWidth=1.5;c.strokeText(r.text,r.preset==='done'?555:500,180);
  if(r.preset==='done'){c.lineWidth=14;c.beginPath();c.moveTo(97,177);c.lineTo(137,220);c.lineTo(200,132);c.stroke();}
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
