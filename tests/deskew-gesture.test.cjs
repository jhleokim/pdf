const test=require('node:test'),assert=require('node:assert/strict');
require('../src/pro-deskew-ui.js');
const {gestureAngle,previewFit,sourceKey}=globalThis.PDFDeskewUIModel;

test('rotary dragging follows clockwise screen coordinates without jumping at the angle wrap',()=>{
  const point=degrees=>({x:100+80*Math.cos(degrees*Math.PI/180),y:100+80*Math.sin(degrees*Math.PI/180)});
  const start={kind:'rotate',cx:100,cy:100,pointerAngle:-90,angle:3};
  assert.equal(gestureAngle(start,point(-70)),23);
  assert.equal(gestureAngle(start,point(-110)),-17);
  assert.equal(gestureAngle({...start,pointerAngle:179,angle:0},point(-179)),2);
  assert.equal(gestureAngle({...start,pointerAngle:-179,angle:0},point(179)),-2);
  assert.equal(gestureAngle(start,point(-20)),60);
  assert.equal(gestureAngle(start,point(-170)),-60);
});

test('horizontal drag retains the starting angle, works on narrow touch targets and clamps both ends',()=>{
  const start={kind:'linear',x:300,width:240,angle:7.5};
  assert.equal(gestureAngle(start,{x:300}),7.5);
  assert.equal(gestureAngle(start,{x:320}),17.5);
  assert.equal(gestureAngle(start,{x:280}),-2.5);
  assert.equal(gestureAngle(start,{x:1000}),60);
  assert.equal(gestureAngle(start,{x:-1000}),-60);
  assert.equal(gestureAngle({...start,width:20},{x:310}),19.5);
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

test('automatic measurement cache retains compact source keys but invalidates edits and orientation',()=>{
  const p={uid:'page-a',docId:'source',srcIndex:2,rotation:0,annots:[{type:'image',data:'a'.repeat(2_000_000)}]},before=sourceKey(p);
  assert.ok(before.length<150);
  p.deskewAngle=3;assert.equal(sourceKey(p),before);
  p.annots[0].data='b'.repeat(2_000_000);assert.notEqual(sourceKey(p),before);
  const annotationKey=sourceKey(p);p.rotation=90;assert.notEqual(sourceKey(p),annotationKey);
  const rotationKey=sourceKey(p);p.uid='page-b';assert.notEqual(sourceKey(p),rotationKey);
});
