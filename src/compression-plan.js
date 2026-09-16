/* Bounded compression policy shared by export, preview and regression tests. */
(function(root){
 'use strict';
 function targetBytes(value){const n=Number(value);return Number.isFinite(n)&&n>0?Math.round(Math.min(2*1024**3,Math.max(100000,n))):0;}
 function scale(spec,options,placement){
  let s=options.optimize?Math.min(1,options.maxDimension/Math.max(spec.width,spec.height)):1;
  if(options.optimize&&options.adaptiveResolution&&placement?.length===2&&placement.every(n=>Number.isFinite(n)&&n>0)){
   // A4 long edge at the selected pixel cap defines the same density for small
   // placed illustrations; use the larger axis to preserve non-square scaling.
   const dpi=options.maxDimension/11.7;
   s=Math.min(s,Math.max(placement[0]*dpi/(72*spec.width),placement[1]*dpi/(72*spec.height)));
  }
  return Math.max(1/Math.min(spec.width,spec.height),s);
 }
 function candidates(spec,options,placement,budget){
  const initial=scale(spec,options,placement),base={scale:initial,quality:options.optimize?options.jpegQuality:.95};
  const plans=[base];
  if(options.optimize&&budget>0&&!options.blackWhite){
   const floor=Math.min(initial,1200/Math.max(spec.width,spec.height));
   for(const [factor,drop]of [[.85,.15],[.7,.3]]){
    const next={scale:Math.max(floor,initial*factor),quality:Math.max(.4,base.quality-drop)};
    if(!plans.some(p=>p.scale===next.scale&&p.quality===next.quality))plans.push(next);
   }
  }
  return plans;
 }
 root.PDFCompressionPlan={targetBytes,scale,candidates};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.PDFCompressionPlan;
})(globalThis);
