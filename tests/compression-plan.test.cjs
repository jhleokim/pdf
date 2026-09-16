const test=require('node:test'),assert=require('node:assert/strict');
const plan=require('../src/compression-plan.js');
const opts={optimize:true,adaptiveResolution:true,maxDimension:2400,jpegQuality:.82};
test('image size follows its largest placement without upsampling or stretching',()=>{
 const spec={width:2400,height:1600};
 assert(plan.scale(spec,opts,[144,96])<.18);
 assert.equal(plan.scale(spec,opts,[1728,1152]),1);
 assert.equal(plan.scale(spec,{...opts,optimize:false},[10,10]),1);
 assert.equal(plan.scale(spec,opts,[NaN,10]),1);
});
test('target comparison is opt-in, at most three, quality bounded and no recursive JPEG input',()=>{
 const spec={width:4000,height:3000};
 assert.equal(plan.candidates(spec,opts,null,0).length,1);
 const a=plan.candidates(spec,opts,null,100000);assert.equal(a.length,3);
 assert(a.every(p=>p.quality>=.4&&p.scale<=.6&&p.scale*4000>=1200));
 assert.equal(plan.candidates(spec,{...opts,blackWhite:true},null,1).length,1);
 assert.equal(plan.candidates({width:600,height:400},{...opts,jpegQuality:.4},null,1).length,1);
 assert.equal(plan.targetBytes(NaN),0);assert.equal(plan.targetBytes(-1),0);assert.equal(plan.targetBytes(Infinity),0);
});
const M=import('mupdf'),inspect=import('../src/compression-placement.mjs');
async function fixture({dynamic=false,pattern=false,form=false,unit=1}={}){
 const m=await M,d=new m.PDFDocument(),pix=new m.Pixmap(m.ColorSpace.DeviceRGB,[0,0,30,20],false);pix.clear(180);
 const im=new m.Image(pix),ref=d.addImage(im);im.destroy();pix.destroy();
 let resources={XObject:{I:ref}},content='q 144 0 0 96 0 0 cm /I Do Q';
 if(form){const f=d.addStream('q 2 0 0 2 0 0 cm /I Do Q',{Type:'XObject',Subtype:'Form',BBox:[0,0,2,2],Matrix:[2,0,0,2,0,0],Resources:resources});resources={XObject:{F:f}};content='q 36 0 0 24 0 0 cm /F Do Q';}
 const p=d.addPage([0,0,600,800],90,resources,content);p.put('UserUnit',unit);d.insertPage(-1,p);
 const p2=d.addPage([0,0,600,800],0,{XObject:{I:ref}},'q 300 0 0 200 0 0 cm /I Do Q');d.insertPage(-1,p2);
 if(dynamic){const page=d.loadPage(0),a=page.createAnnotation('Text');a.setContents('Note');a.update();a.destroy();page.destroy();}
 if(pattern)d.addObject({Type:'Pattern',PatternType:1});
 const b=d.saveToBuffer();try{return {bytes:b.asUint8Array().slice(),id:ref.asIndirect()};}finally{b.destroy();d.destroy();}
}
test('native inspection uses maximum across pages and resolves nested Form matrices',async()=>{
 const {imagePlacements}=await inspect;
 for(const form of [false,true]){const {bytes,id}=await fixture({form});const out=await imagePlacements(bytes);assert(Math.abs(out.placements[id][0]-300)<.1);assert(Math.abs(out.placements[id][1]-200)<.1);}
});
test('native inspection respects rotated pages and UserUnit physical sizes',async()=>{
 const {bytes,id}=await fixture({unit:3}),out=await(await inspect).imagePlacements(bytes);
 assert(Math.abs(out.placements[id][0]-432)<.1);assert(Math.abs(out.placements[id][1]-288)<.1);
});
test('annotations and pattern documents use safe fallback rather than incomplete placements',async()=>{
 for(const options of [{dynamic:true},{pattern:true}]){const {bytes}=await fixture(options),out=await(await inspect).imagePlacements(bytes);assert.deepEqual(out.placements,{});assert(out.reason);}
});
