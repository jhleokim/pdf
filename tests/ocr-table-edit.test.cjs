const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({structuredClone});
for(const file of ['ocr-tables.js','ocr-table-edit.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context);
const T=context.PDFOCRTables,E=context.PDFOCRTableEdit,plain=x=>JSON.parse(JSON.stringify(x));
function fixture(rows=3,cols=3){
  const x=Array.from({length:cols+1},(_,i)=>.05+.9*i/cols),y=Array.from({length:rows+1},(_,i)=>.05+.9*i/rows),words=[];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)words.push({text:`value-${r}-${c}`,box:[x[c]+.01,y[r]+.01,x[c]+.04,y[r]+.035],separator:'\n',confidence:99});
  return {words,table:T.fromGrid({x,y,words})};
}
function coverage(table){
  const count=new Array((table.x.length-1)*(table.y.length-1)).fill(0),cols=table.x.length-1,ids=new Set();
  for(const cell of table.cells){assert.ok(!ids.has(cell.id));ids.add(cell.id);for(let r=cell.row;r<cell.row+cell.rowSpan;r++)for(let c=cell.col;c<cell.col+cell.colSpan;c++){assert.ok(r>=0&&r<table.y.length-1&&c>=0&&c<cols);count[r*cols+c]++;}}
  assert.ok(count.every(n=>n===1),'every slot must occur exactly once');
}
test('row/column insertion and deletion remain rectangular and leave source records untouched',()=>{
  for(let rows=2;rows<=6;rows++)for(let cols=2;cols<=6;cols++)for(const axis of ['x','y']){
    const {table,words}=fixture(rows,cols),before=plain({table,words}),n=table[axis].length-1;
    for(const i of new Set([0,Math.floor(n/2),n-1])){
      const inserted=E.insertBand(table,axis,i,words);assert.equal(inserted[axis].length,table[axis].length+1);coverage(inserted);
      const deleted=E.deleteBand(table,axis,i,words);assert.equal(deleted[axis].length,table[axis].length-1);coverage(deleted);
      const removed=words.filter((_,index)=>axis==='x'?index%cols===i:Math.floor(index/cols)===i);
      for(const word of removed)assert.ok(!T.toTSV(deleted).includes(word.text));
      assert.equal(T.toTSV(T.refresh(deleted,words)),T.toTSV(deleted));
    }
    assert.deepEqual(plain({table,words}),before);
  }
});
test('splitting one ordinary cell preserves surrounding cells as merged across the new grid line',()=>{
  for(const axis of ['x','y']){
    const {table,words}=fixture(),result=E.splitCell(table,'r1c1',axis,words);coverage(result);
    assert.equal(result.cells.length,table.cells.length+1);
    const other=result.cells.find(c=>c.text==='value-0-0');assert.ok(other);
    assert.equal(T.toTSV(table).includes('value-1-1'),true);
    const merged=T.merge(table,['r0c0','r0c1'],words),unmerged=E.splitCell(merged,'r0c0','x',words);coverage(unmerged);assert.equal(unmerged.x.length,merged.x.length);
  }
});
test('manual text survives insertion and cannot be split by guessing character positions',()=>{
  const {table,words}=fixture();table.cells.find(c=>c.id==='r1c1').text='정정한 금액 1,234,567';table.cells.find(c=>c.id==='r1c1').edited=true;table.reviewed=true;
  const result=E.insertBand(table,'y',1,words),cell=result.cells.find(c=>c.text==='정정한 금액 1,234,567');
  assert.equal(cell.rowSpan,2);assert.equal(result.reviewed,false);coverage(result);
  assert.throws(()=>E.splitCell(table,'r1c1','x',words),/보관/);
});
test('column deletion preserves a merged heading and retains removed values without resurrecting them',()=>{
  const {table,words}=fixture();const merged=T.merge(table,['r0c0','r0c1','r0c2'],words);merged.trace={horizontal:[]};
  const heading=merged.cells[0].text,result=E.deleteBand(merged,'x',1,words);coverage(result);
  assert.equal(result.cells[0].text,heading);assert.equal(result.cells[0].colSpan,2);assert.equal(result.trace,undefined);
  assert.ok(result.deletedCells.some(c=>c.text==='value-1-1'));assert.ok(result.excludedWordIndices.includes(4));
  const moved=T.moveBoundary(result,'x',1,.65,words);assert.ok(!T.toTSV(moved).includes('value-1-1'));
  assert.equal(merged.excludedWordIndices?.length||0,0);
});
test('removing a band crossed by a merged cell preserves its text for review',()=>{
  const {table,words}=fixture(),merged=T.merge(table,['r0c0','r1c0'],words),text=merged.cells[0].text;
  const result=E.deleteBand(merged,'y',0,words);coverage(result);
  assert.equal(result.cells.find(c=>c.id==='r0c0').text,text);assert.ok(result.cells.find(c=>c.id==='r0c0').needsReview);
});
test('invalid edits and resource limit failures do not alter the input table',()=>{
  const {table,words}=fixture(1,1),before=plain(table);
  assert.throws(()=>E.deleteBand(table,'y',0,words),/마지막/);assert.throws(()=>E.insertBand(table,'x',8,words));assert.throws(()=>E.splitCell(table,'missing','x',words));assert.throws(()=>E.insertBand(table,'z',0,words));
  assert.deepEqual(plain(table),before);
  const large=fixture(20,30),snapshot=plain(large.table);assert.throws(()=>E.insertBand(large.table,'y',3,large.words),/600/);assert.deepEqual(plain(large.table),snapshot);
});
