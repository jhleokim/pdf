/* Decide locally whether OCR should fill missing text or replace a text layer. */
(function(root){
  'use strict';
  function textBoxes(items,viewport){
    const t=viewport.transform;
    return items.filter(i=>i.str?.trim()&&i.transform).map(i=>{
      const m=i.transform,x=t[0]*m[4]+t[2]*m[5]+t[4],y=t[1]*m[4]+t[3]*m[5]+t[5];
      const height=Math.max(1,Math.hypot(m[2],m[3])*viewport.scale),width=Math.max(1,i.width*viewport.scale);
      const angle=Math.atan2(t[1]*m[0]+t[3]*m[1],t[0]*m[0]+t[2]*m[1]);
      return {x,y,width,height,angle};
    });
  }
  function decide({items=[],hasImages=false,force=false}={}){
    const count=items.reduce((n,i)=>n+(i.str?.trim().length||0),0);
    if(force)return {action:'recognize',preserveExisting:false};
    if(!count)return {action:'recognize',preserveExisting:false};
    // A page number or header never proves that a scan body is searchable.
    if(hasImages)return {action:'fill-gaps',preserveExisting:true};
    return {action:'skip',preserveExisting:true};
  }
  function coverExisting(context,items,viewport){
    context.save();context.fillStyle='#fff';
    for(const box of textBoxes(items,viewport)){
      context.save();context.translate(box.x,box.y);context.rotate(box.angle);
      context.fillRect(-1,-box.height*1.05-1,box.width+2,box.height*1.35+2);context.restore();
    }
    context.restore();
  }
  root.PDFOCRPolicy={decide,textBoxes,coverExisting};
  if(typeof module!=='undefined')module.exports=root.PDFOCRPolicy;
})(globalThis);
