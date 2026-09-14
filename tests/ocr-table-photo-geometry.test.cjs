const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({performance});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ocr-tables.js'),'utf8'),context);const api=context.PDFOCRTables,plain=value=>JSON.parse(JSON.stringify(value));

// Geometry-only regression derived from a common two-section expense form.
// No photographed names, signatures, document text or image bytes are retained.
function photographedForm({denseHeaderInk=false,straight=false}={}){
  const width=900,height=1280,data=new Uint8ClampedArray(width*height*4).fill(255),image={width,height,data};
  const pixel=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||x>=width||y<0||y>=height)return;const at=(y*width+x)*4;data[at]=data[at+1]=data[at+2]=30;};
  const bend=(x,y)=>{if(straight)return [x,y];const u=(x-110)/700;return [x+.0013*(y-180),y+3.5*Math.sin(u*Math.PI)-4*u*Math.max(0,(y-405)/510)];};
  function rule(x0,y0,x1,y1){const count=Math.ceil(Math.max(Math.abs(x1-x0),Math.abs(y1-y0)));for(let step=0;step<=count;step++){const [x,y]=bend(x0+(x1-x0)*step/count,y0+(y1-y0)*step/count);pixel(x,y);pixel(x,y+1);}}
  // Decorative outer frame must never absorb the nested data grids.
  for(const y of [108,1180])rule(98,y,820,y);for(const x of [98,820])rule(x,108,x,1180);
  const metaX=[110,207,457,553,810],metaY=[180,225,270,315,360,405];
  for(const x of metaX)rule(x,180,x,405);for(const y of metaY)rule(110,y,810,y);
  const costX=[110,263,360,457,553,650,747,810],costY=[405,447,480,510,550,590,630,670,710,750,790,830,870,910];
  for(const y of costY.slice(1))rule(y===480?360:110,y,y===480?650:810,y);
  for(const x of costX)rule(x,x===110||x===810?405:x===457||x===553?480:447,x,910);
  if(denseHeaderInk){rule(759,478,799,478);for(let x=759;x<=799;x+=4)rule(x,474,x,483);}
  return image;
}

test('gently curved adjoining form grids recover their own columns and both merged-header directions',()=>{
  const image=photographedForm(),out=api.detect(image),tables=out.tables;
  assert.equal(tables.length,2,JSON.stringify(out.warnings));
  assert.deepEqual(plain(tables.map(table=>[table.y.length-1,table.x.length-1,table.cells.length])),[[5,4,20],[13,7,79]]);
  const costs=tables[1];assert.deepEqual(plain(costs.cells.filter(cell=>cell.rowSpan>1||cell.colSpan>1).map(cell=>[cell.row,cell.col,cell.rowSpan,cell.colSpan])),[[0,0,1,7],[1,0,2,1],[1,1,2,1],[1,2,1,3],[1,5,2,1],[1,6,2,1]]);
  assert.ok(tables.every(table=>table.box[0]>.12&&table.box[1]>.13&&table.box[2]<.91&&table.box[3]<.73),'the outside document frame is excluded');
  assert.ok(costs.trace.horizontal.some(line=>Math.max(...line.points.map(point=>point[1]))-Math.min(...line.points.map(point=>point[1]))>3/1280));
  assert.ok(out.warnings.some(warning=>warning.includes('휜 테두리')));assert.equal(out.metrics.cells,111);
  assert.ok(tables.every(table=>table.reviewed===false&&table.cells.every(cell=>cell.text==='')),'structure recognition never invents OCR text');
});

test('selected cost-table scope uses full-page coordinates and keeps all last-row columns',()=>{
  const out=api.detect(photographedForm(),{region:[.115,.309,.915,.725]});
  assert.equal(out.tables.length,1,JSON.stringify(out.warnings));const table=out.tables[0];
  assert.equal(table.y.length-1,13);assert.equal(table.x.length-1,7);assert.equal(table.cells.length,79);
  assert.equal(table.cells.filter(cell=>cell.row===12).length,7);assert.ok(table.box[1]>.315&&table.box[3]>.70);
});

test('curved traces are bounded, normalized, cover only existing header rules and invalidate on manual movement',()=>{
  const table=api.detect(photographedForm()).tables[1];
  for(const axis of ['horizontal','vertical'])for(const trace of table.trace[axis]){
    assert.ok(Number.isInteger(trace.index));assert.ok(trace.points.length>=2&&trace.points.length<=49);
    assert.ok(trace.points.every(point=>point.length===2&&point.every(value=>Number.isFinite(value)&&value>=0&&value<=1)));
  }
  const headerLine=table.trace.horizontal.filter(trace=>trace.index===2);assert.ok(headerLine.length);
  assert.ok(headerLine.every(trace=>trace.points.every(point=>point[0]>.39&&point[0]<.73)),'partial header rule must not cross rowspan cells');
  assert.ok(api.refresh(table,[]).trace);const moved=api.moveBoundary(table,'x',1,table.x[1]+.002,[]);assert.equal(moved.trace,undefined);assert.ok(table.trace,'source table stays immutable');
});

test('an explicitly removed word cannot silently reappear when remaining cells are expanded',()=>{
  const words=[{text:'삭제 대상',box:[.2,.2,.3,.3],confidence:95},{text:'유지',box:[.6,.2,.7,.3],confidence:95}],before=structuredClone(words),table=api.fromGrid({x:[.1,.5,.9],y:[.1,.5],words});
  table.excludedWordIndices=[0,0,-1,100,'0'];const result=api.refresh(table,words);
  assert.deepEqual(plain(result.excludedWordIndices),[0]);assert.deepEqual(plain(result.cells.map(cell=>cell.text)),['','유지']);assert.deepEqual(plain(result.unassignedIndices),[]);assert.deepEqual(words,before);
  assert.notEqual(result.excludedWordIndices,table.excludedWordIndices);const merged=api.merge(result,['r0c0','r0c1'],words);assert.equal(merged.cells[0].text,'유지');assert.deepEqual(plain(merged.excludedWordIndices),[0]);
});

test('dense resampled header glyph strokes do not split a vertically merged header cell',()=>{
  const out=api.detect(photographedForm({denseHeaderInk:true}));assert.equal(out.tables.length,2);
  const table=out.tables[1];assert.equal(table.cells.length,79);const cell=table.cells.find(cell=>cell.row===1&&cell.col===6);assert.equal(cell.rowSpan,2);
});

test('straight table rules do not receive a curvature warning from isolated dark intersections',()=>{
  const image=photographedForm({straight:true});
  for(let y=175;y<187;y++)for(let x=107;x<114;x++){const at=(y*image.width+x)*4;image.data[at]=image.data[at+1]=image.data[at+2]=30;}
  const out=api.detect(image);assert.equal(out.tables.length,2);assert.ok(out.tables.every(table=>!table.issues.includes('curved-border')));assert.ok(!out.warnings.some(warning=>warning.includes('휜 테두리')));
});

module.exports={photographedForm};
