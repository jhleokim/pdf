const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({structuredClone});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ocr-correction.js'),'utf8'),context);
const api=context.PDFOCRCorrection.data;
const fixture=()=>[{uid:'page-1',key:'rotated-90',page:2,source:'ppocr-v5',language:'kor+eng',words:[{text:'원래',box:[.1,.2,.3,.4],separator:' ',confidence:62,uncertain:true,quad:[[.1,.2],[.3,.2],[.3,.4],[.1,.4]]},{text:'문장',box:[.4,.2,.6,.4],separator:'\n',confidence:94}],text:'원래 문장'}];
const plain=value=>JSON.parse(JSON.stringify(value));
test('draft editing isolates original records, nested geometry, and cancelled work',()=>{
  const source=fixture(),original=structuredClone(source),draft=api.createDraft(source);
  api.updateWord(draft,0,0,'교정한');draft.records[0].words[0].quad[0][0]=.11;
  assert.deepEqual(source,original);assert.equal(api.changedWords(draft),1);assert.equal(draft.original[0].words[0].text,'원래');
  assert.equal(api.createDraft(source).records[0].words[0].text,'원래');
});
test('apply rebuilds text while preserving geometry, source version, and separators',()=>{
  const source=fixture(),draft=api.createDraft(source);api.updateWord(draft,0,0,'수정');const out=api.materialize(draft);
  assert.equal(out[0].text,'수정 문장');assert.equal(out[0].key,source[0].key);assert.equal(out[0].source,source[0].source);
  assert.deepEqual(plain(out[0].words[0].box),source[0].words[0].box);assert.deepEqual(plain(out[0].words[0].quad),source[0].words[0].quad);
  assert.equal(out[0].words[0].separator,' ');assert.equal(out[0].words[0].corrected,true);assert.equal(out[0].words[0].uncertain,false);assert.equal(out[0].words[0].confidence,62);
  out[0].words[0].text='external';assert.equal(draft.records[0].words[0].text,'수정');assert.equal(source[0].words[0].text,'원래');
});
test('empty text removes searchable content but keeps the original editable region',()=>{
  const draft=api.createDraft(fixture());api.updateWord(draft,0,0,'');const out=api.materialize(draft);
  assert.equal(out[0].words.length,2);assert.equal(out[0].words[0].text,'');assert.equal(out[0].text,'문장');assert.equal(out[0].words[0].box[0],.1);
  api.updateWord(draft,0,0,'원래');assert.equal(api.changedWords(draft),0);assert.equal(api.materialize(draft)[0].words[0].corrected,undefined);
});
test('pasted line breaks become spaces within a fixed OCR region',()=>{
  const draft=api.createDraft(fixture());assert.equal(api.updateWord(draft,0,0,'첫째\r\n둘째\u2028셋째'),'첫째 둘째 셋째');
  assert.equal(api.materialize(draft)[0].text,'첫째 둘째 셋째 문장');
});
test('skipped pages stay unmodified and geometry-free text remains correctable',()=>{
  const draft=api.createDraft([{uid:'skip',skipped:true,words:[],text:'기존 텍스트'},{uid:'plain',words:[],text:'교정 전'}]);
  assert.throws(()=>api.updateWord(draft,0,0,'x'));draft.records[1].text='교정 후\n여러 줄';assert.equal(api.changedWords(draft),1);
  const out=api.materialize(draft);assert.equal(out[0].text,'기존 텍스트');assert.equal(out[1].text,'교정 후\n여러 줄');
});
test('selection overlay uses only finite normalized canonical boxes, with legacy fallback',()=>{
  assert.deepEqual(plain(api.boxOf({box:[.1,.2,.8,.9]})),[.1,.2,.8,.9]);assert.deepEqual(plain(api.boxOf({x:.1,y:.2,w:.5,h:.5})),[.1,.2,.6,.7]);
  for(const box of [[0,0,2,1],[.4,0,.2,1],[0,NaN,1,1],[0,0,1],[-.1,0,1,1]])assert.equal(api.boxOf({box}),null);
});
