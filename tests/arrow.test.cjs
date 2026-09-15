const test=require('node:test'),assert=require('node:assert/strict'),{geometry,endpoint}=require('../src/markup-arrow.js');
test('arrows retain all directions, including horizontal and vertical lines',()=>{
 for(const [dx,dy]of [[.2,0],[-.2,0],[0,.2],[0,-.2],[.2,.2],[-.2,.2],[.2,-.2],[-.2,-.2]]){
  const a={nx:.5,ny:.5,nw:dx,nh:dy,pageWidth:600,lineWidth:2},g=geometry(a,600,800);
  assert(g.length>0);assert.deepEqual(g.end,[(.5+dx)*600,(.5+dy)*800]);
  assert(Math.abs(g.head[1][0]+g.head[2][0]-2*g.base[0])<1e-8);
 }
});
test('dragging an endpoint across the other keeps the fixed endpoint unchanged',()=>{
 const a={nx:.2,ny:.3,nw:.4,nh:.2};endpoint(a,'start',.8,.8);
 assert(Math.abs(a.nx+a.nw-.6)<1e-8);assert.equal(a.ny+a.nh,.5);assert(a.nw<0&&a.nh<0);
 endpoint(a,'end',.1,.1);assert.equal(a.nx,.8);assert.equal(a.ny,.8);
});
test('head and stroke scale with the page, not global preview zoom',()=>{
 const a={nx:.1,ny:.1,nw:.6,nh:.5,lineWidth:3,pageWidth:600},full=geometry(a,600,800),thumb=geometry(a,120,160);
 assert(Math.abs(thumb.stroke-full.stroke*.2)<1e-8);assert(Math.abs(thumb.base[0]-full.base[0]*.2)<1e-8);
 assert(geometry({...a,nw:0,nh:0},600,800).head.flat().every(Number.isFinite));
});
