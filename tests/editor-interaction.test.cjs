const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/editor.js'),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

test('select-all button toggles all/none, while keyboard select-all remains idempotent',()=>{
 const els=new Map();const el=id=>{if(!els.has(id))els.set(id,{});return els.get(id);};
 const pages=Array.from({length:3},()=>({el:{classList:{value:false,add(){this.value=true;},remove(){this.value=false;}}}}));
 const c=vm.createContext({pages,$:el,selected:()=>pages.filter(p=>p.el.classList.value),syncCounts(){},lastClicked:'p1'});
 vm.runInContext(extract('const selectAll =',"$('btnDel').onclick"),c);
 el('btnAll').onclick();assert.equal(pages.filter(p=>p.el.classList.value).length,3);
 el('btnAll').onclick();assert.equal(pages.filter(p=>p.el.classList.value).length,0);
 pages[1].el.classList.add();el('mbAll').onclick();assert.equal(pages.filter(p=>p.el.classList.value).length,3);
 vm.runInContext('selectAll();selectAll();',c);assert.equal(pages.filter(p=>p.el.classList.value).length,3);
});

test('markup SVG uses opaque borders and independently adjustable fill, including 0%',()=>{
 const c=vm.createContext({SVGNS:'svg',pvScale:1,document:{createElementNS(ns,tag){return {tag,dataset:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;}};}}});
 vm.runInContext(extract('function annoToSVG','function renderAnnots'),c);
 for(const shape of ['rect','ellipse'])for(const opacity of [0,.35,1]){
  c.a={shape,opacity,fill:'#ffe082',stroke:'#bf342e',lineWidth:2,nx:0,ny:0,nw:.5,nh:.5};
  const el=vm.runInContext('annoToSVG(a,100,100)',c);
  assert.equal(el.attrs['stroke-opacity'],1);assert.equal(el.attrs['fill-opacity'],opacity);
 }
});

test('saved rectangles and ellipses keep stroke alpha at 1 when fill alpha is 0',async()=>{
 const calls=[];
 const viewport={width:100,height:100,rotation:0,convertToPdfPoint:(x,y)=>[x,100-y]};
 const c=vm.createContext({docs:new Map([['d',{pdfjsDoc:{getPage:async()=>({getViewport:()=>viewport})}}]]),
  hexToRgb:()=>({r:.1,g:.2,b:.3}),rgb:(r,g,b)=>({r,g,b}),p:{docId:'d',srcIndex:0,rotation:0,annots:['rect','ellipse'].map(shape=>({shape,nx:.1,ny:.1,nw:.5,nh:.5,fill:'#ffe082',stroke:'#bf342e',lineWidth:2,dash:'solid',opacity:0}))},
  pg:{drawRectangle:o=>calls.push(o),drawEllipse:o=>calls.push(o)}});
 vm.runInContext(extract('async function bakeAnnots','async function buildEditedDocument'),c);
 await vm.runInContext('bakeAnnots({},pg,p,new Map())',c);
 assert.equal(calls.length,2);for(const call of calls){assert.equal(call.borderOpacity,1);assert.equal(call.opacity,0);}
});
