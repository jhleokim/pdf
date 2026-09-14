const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({structuredClone});
for(const name of ['ocr-tables.js','ocr-correction.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),context);
const api=context.PDFOCRCorrection.data,tables=context.PDFOCRTables,plain=value=>JSON.parse(JSON.stringify(value));
const fixture=()=>[{uid:'contract',key:'source-1',page:1,source:'vision',text:'계좌 001234',words:[{text:'계좌',box:[.12,.15,.20,.19],confidence:99,separator:' '},{text:'001234',box:[.60,.15,.74,.19],confidence:99,separator:'\n'}]}];
const addTable=record=>{record.tables=[tables.fromGrid({x:[.1,.5,.9],y:[.1,.3],words:record.words})];return record;};
test('table-only draft changes enable applying without touching OCR text or geometry',()=>{
  const source=fixture(),draft=api.createDraft(source);addTable(draft.records[0]);draft.records[0].tables[0].cells[1].text='009876';draft.records[0].tables[0].cells[1].edited=true;
  assert.equal(api.changedWords(draft),0);assert.equal(api.changedTables(draft),1);assert.equal(api.changedItems(draft),1);
  const result=api.materialize(draft);assert.equal(result[0].tables[0].cells[1].text,'009876');assert.equal(result[0].text,source[0].text);assert.deepEqual(plain(result[0].words),source[0].words);assert.equal(source[0].tables,undefined);
});
test('cancelled table corrections and structural edits leave source records untouched',()=>{
  const source=fixture().map(addTable),saved=plain(source),draft=api.createDraft(source);draft.records[0].tables[0]=tables.merge(draft.records[0].tables[0],['r0c0','r0c1'],draft.records[0].words);
  assert.equal(api.changedTables(draft),1);assert.deepEqual(plain(source),saved);assert.equal(api.createDraft(source).records[0].tables[0].cells.length,2);
});
test('an untouched reviewed table survives apply and reopen without spurious changes',()=>{
  const source=fixture().map(addTable);source[0].tables[0].reviewed=true;const draft=api.createDraft(source);api.refreshTables(draft.records[0]);assert.equal(api.changedItems(draft),0);
  const applied=api.materialize(draft);assert.equal(applied[0].tables[0].reviewed,true);assert.equal(api.changedItems(api.createDraft(applied)),0);
});
test('line edits update only derived table text and invalidate a previous review',()=>{
  const source=fixture().map(addTable);source[0].tables[0].reviewed=true;source[0].tables[0].cells[1].text='수동 보정';source[0].tables[0].cells[1].edited=true;
  const draft=api.createDraft(source);api.updateWord(draft,0,0,'은행');api.updateWord(draft,0,1,'새 번호');api.refreshTables(draft.records[0]);
  assert.equal(draft.records[0].tables[0].cells[0].text,'은행');assert.equal(draft.records[0].tables[0].cells[1].text,'수동 보정');assert.equal(draft.records[0].tables[0].reviewed,false);
  assert.equal(api.materialize(draft)[0].text,'은행 새 번호');
});
test('multiple pages retain independent table drafts and deleting a saved table is a change',()=>{
  const source=[...fixture().map(addTable),{...fixture()[0],uid:'second',page:2}],draft=api.createDraft(source);draft.records[0].tables=[];addTable(draft.records[1]);
  assert.equal(api.changedTables(draft),2);const result=api.materialize(draft);assert.equal(result[0].tables.length,0);assert.equal(result[1].tables[0].cells.length,2);result[1].tables[0].cells[0].text='외부 변경';assert.equal(draft.records[1].tables[0].cells[0].text,'계좌');
});
test('manual cell review does not resolve crossing text without explicit confirmation',()=>{
  const source=fixture();source[0].words=[{text:'성명 홍길동',box:[.12,.15,.75,.19],confidence:99}];const draft=api.createDraft(source);addTable(draft.records[0]);let table=draft.records[0].tables[0];table.cells[0].text='성명';table.cells[0].edited=true;table.cells[1].text='홍길동';table.cells[1].edited=true;table.reviewed=true;
  assert.throws(()=>tables.toTSV(table));table=tables.resolveWord(table,0,draft.records[0].words);draft.records[0].tables[0]=table;const result=api.materialize(draft);assert.equal(result[0].words[0].text,'성명 홍길동');assert.equal(result[0].tables[0].resolutions[0].text,'성명 홍길동');assert.equal(tables.toTSV(result[0].tables[0]),'성명\t홍길동');
  result[0].tables[0].cells[1].text='수정한 값';api.refreshTables(result[0]);assert.throws(()=>tables.toTSV(result[0].tables[0]));
});
