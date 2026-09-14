const test=require('node:test'),assert=require('node:assert/strict');
require('../src/pro-deskew-ui.js');
const {gestureAngle,previewFit,previewLayout,sourceKey}=globalThis.PDFDeskewUIModel;
const {geometry}=require('../src/pro-deskew.js');

test('ruler follows the finger at ten pixels per degree, independent of screen width, and clamps both ends',()=>{
  const start={x:300,width:240,angle:7.5};
  assert.equal(gestureAngle(start,{x:300}),7.5);
  assert.equal(gestureAngle(start,{x:320}),5.5);
  assert.equal(gestureAngle(start,{x:280}),9.5);
  assert.equal(gestureAngle(start,{x:1000}),-60);
  assert.equal(gestureAngle(start,{x:-1000}),60);
  assert.equal(gestureAngle({...start,width:20},{x:310}),6.5);
  assert.equal(gestureAngle({...start,width:1200},{x:310}),6.5);
  assert.equal(gestureAngle(start,{x:301}),7.4);
  assert.equal(gestureAngle(start,{x:299}),7.6);
});

test('drag preview fits every rotated corner inside desktop and phone viewports',()=>{
  for(const [w,h]of[[1200,1800],[1800,1200]])for(const [availableW,availableH]of[[740,800],[280,420]])for(const angle of[-60,-40,-3,0,3,40,60]){
    const fit=previewFit(w,h,angle,availableW,availableH),a=angle*Math.PI/180;
    for(const x of[-w/2,w/2])for(const y of[-h/2,h/2]){
      assert.ok(Math.abs((Math.cos(a)*x-Math.sin(a)*y)*fit)<=availableW/2+1e-8);
      assert.ok(Math.abs((Math.sin(a)*x+Math.cos(a)*y)*fit)<=availableH/2+1e-8);
    }
  }
});

test('preview layout matches the PDF engine with cropping on and off across signed angles and page ratios',()=>{
  for(const [width,height]of[[210,297],[297,210],[100,100],[100,600]])for(const [availableW,availableH]of[[740,800],[280,420]])for(const angle of[-60,-40,-3,-.1,0,.1,3,40,60])for(const crop of[false,true]){
    const layout=previewLayout(width,height,angle,availableW,availableH,crop),pdf=geometry({x:37,y:-21,width,height},-angle,{cropCorners:crop});
    assert.ok(Math.abs(layout.width/layout.scale-pdf.bounds.width)<1e-9);
    assert.ok(Math.abs(layout.height/layout.scale-pdf.bounds.height)<1e-9);
    assert.ok(Math.abs(layout.retainedAreaRatio-pdf.retainedAreaRatio)<1e-12);
    assert.ok(layout.width<=availableW+1e-8);assert.ok(layout.height<=availableH+1e-8);
    if(crop)assert.ok(Math.abs(layout.width/layout.height-width/height)<1e-9);
    else{assert.equal(layout.retainedAreaRatio,1);assert.ok(Math.abs(layout.scale-previewFit(width,height,angle,availableW,availableH))<1e-12);}
  }
  for(const crop of[false,true])assert.equal(previewLayout(210,297,0,400,500,crop).retainedAreaRatio,1);
});

test('automatic measurement cache retains compact source keys but invalidates edits and orientation',()=>{
  const p={uid:'page-a',docId:'source',srcIndex:2,rotation:0,annots:[{type:'image',data:'a'.repeat(2_000_000)}]},before=sourceKey(p);
  assert.ok(before.length<150);
  p.deskewAngle=3;assert.equal(sourceKey(p),before);
  p.deskewCrop=true;assert.equal(sourceKey(p),before);p.deskewCrop=false;assert.equal(sourceKey(p),before);delete p.deskewCrop;assert.equal(sourceKey(p),before);
  p.annots[0].data='b'.repeat(2_000_000);assert.notEqual(sourceKey(p),before);
  const annotationKey=sourceKey(p);p.rotation=90;assert.notEqual(sourceKey(p),annotationKey);
  const rotationKey=sourceKey(p);p.uid='page-b';assert.notEqual(sourceKey(p),rotationKey);
});
