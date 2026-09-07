const test=require('node:test'),assert=require('node:assert/strict');
const deskew=require('../src/pro-deskew.js');
function raster(angle,kind='text'){
 const width=800,height=1000,data=new Uint8ClampedArray(width*height*4).fill(255),s=Math.tan(angle*Math.PI/180);
 if(kind==='blank')return {data,width,height};
 let seed=123;
 for(let y=50;y<950;y++)for(let x=50;x<750;x++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const row=y-s*(x-400),line=Math.floor((row-100)/34),ink=line>=0&&line<23&&(row-100)%34>=0&&(row-100)%34<11&&(x+line*7)%13<8&&x<700-line%4*50;
  if(kind==='noise'?seed%5===0:ink){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=20;}
 }
 return {data,width,height};
}
test('offline deskew finds both tilt directions and leaves level/blank/noise pages unchanged',()=>{
 for(const angle of [-5,-3,2,4.5]){const r=deskew.detect(raster(angle));assert.ok(Math.abs(r.angle-angle)<=.2,JSON.stringify({angle,r}));}
 for(const kind of ['text','blank','noise'])assert.equal(deskew.detect(raster(0,kind)).angle,0,kind);
});
test('deskew fits every original corner within the unchanged offset crop box',()=>{
 const box={x:32,y:-17,width:600,height:800};
 for(const angle of [-7,-3,3,7]){
  const [a,b,c,d,e,f]=deskew.matrix(box,angle);
  for(const x of [box.x,box.x+box.width])for(const y of [box.y,box.y+box.height]){
   const xx=a*x+c*y+e,yy=b*x+d*y+f;
   assert.ok(xx>=box.x-1e-8&&xx<=box.x+box.width+1e-8);
   assert.ok(yy>=box.y-1e-8&&yy<=box.y+box.height+1e-8);
  }
 }
});
