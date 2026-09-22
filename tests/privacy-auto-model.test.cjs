const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../src/privacy-auto-model.js');
const ocrContext=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/pro-ocr.js'),'utf8'),ocrContext);
const correctionWords=ocrContext.PDFOCR.correctionWords;
const word=(text,box=[.1,.1,.4,.2],extra={})=>({text,box,separator:' ',...extra});
const fixture=()=>({uid:'page-1',key:'old-key',privacyKey:'old-mask-key',page:3,source:'paddle-v5',language:'kor+eng',layout:'auto',coverage:'full',confidence:null,granularity:'line',model:'local-model',modelCacheTag:'spotting-v1',canEmbed:true,coordinateStatus:'detected-lines',nativeTextBoxes:[[.1,.7,.7,.8]],nativeTextUnmapped:false,words:[word('공개',[.1,.1,.3,.15]),word('900101-1234567',[.1,.3,.6,.35]),word('남은 글자',[.1,.5,.4,.55],{separator:'\n'})],text:'원래 전체 텍스트 900101-1234567',rawText:'900101-1234567',response:{text:'900101-1234567'},tables:[{cells:[{text:'900101-1234567'}]}],correctionGroups:[{indices:[1],text:'900101-1234567'}]});

test('partial overlap removes the whole OCR word and every original body/table payload',()=>{
  const record=fixture(),original=structuredClone(record),out=api.sanitizeRecord(record,[[.35,.30,.38,.34]],correctionWords);
  assert.deepEqual(out.words.map(w=>w.text),['공개','남은 글자']);assert.equal(out.text,'공개 남은 글자');
  for(const field of ['rawText','response','tables','correctionLines','correctionGroups'])assert.equal(Object.hasOwn(out,field),false,field);
  assert.equal(JSON.stringify(out).includes('900101'),false);assert.deepEqual(record,original);
});

test('keeps only required scalar metadata and deep-clones geometry/basis of surviving text',()=>{
  const record=fixture();record.words[0].nativeBasis=[.1,.15,.2,0,0,.05];record.words[0].quad=[[.1,.1],[.3,.1],[.3,.15],[.1,.15]];record.words[0].rawText='discard this';record.words[0].payload={secret:'discard this'};record.words[0].confidence=96;record.words[0].uncertain=false;
  const out=api.sanitizeRecord(record,[[.1,.3,.6,.35]],correctionWords);
  for(const field of ['uid','key','privacyKey','page','source','language','layout','coverage','confidence','modelCacheTag','canEmbed','coordinateStatus','nativeTextUnmapped','granularity','model'])assert.equal(out[field],record[field],field);
  assert.deepEqual(out.nativeTextBoxes,record.nativeTextBoxes);assert.notEqual(out.nativeTextBoxes,record.nativeTextBoxes);assert.notEqual(out.nativeTextBoxes[0],record.nativeTextBoxes[0]);
  assert.deepEqual(out.words[0].nativeBasis,record.words[0].nativeBasis);assert.notEqual(out.words[0].nativeBasis,record.words[0].nativeBasis);assert.notEqual(out.words[0].quad[0],record.words[0].quad[0]);assert.notEqual(out.words[0].box,record.words[0].box);
  assert.equal(Object.hasOwn(out.words[0],'rawText'),false);assert.equal(Object.hasOwn(out.words[0],'payload'),false);
});

test('exact edge and corner contact are excluded conservatively; truly disjoint words stay',()=>{
  const masks=[[.2,.2,.4,.4]],record={words:[word('left edge',[.1,.22,.2,.3]),word('bottom edge',[.22,.4,.3,.5]),word('corner',[.4,.4,.5,.5]),word('outside',[.4001,.2,.6,.3])]};
  const out=api.sanitizeRecord(record,masks,correctionWords);assert.deepEqual(out.words.map(w=>w.text),['outside']);
  assert.deepEqual(api.sanitizeRecord({words:[word('rounding',[.40000005,.2,.6,.3])]},masks,correctionWords).words,[]);
});

test('uses effective corrected lines, never brings deleted original text back',()=>{
  const record=fixture();record.correctionLines=[{indices:[1],box:record.words[1].box,text:''}];
  const out=api.sanitizeRecord(record,[],correctionWords);assert.equal(out.text,'공개 남은 글자');assert.equal(out.words.length,2);assert.equal(JSON.stringify(out).includes('900101'),false);
  record.correctionLines=[{indices:[1],box:record.words[1].box,text:'교정한 안전한 문장'}];
  const revised=api.sanitizeRecord(record,[],correctionWords);assert.equal(revised.words[1].text,'교정한 안전한 문장');assert.equal(revised.words[1].correctionLine,true);assert.equal(JSON.stringify(revised).includes('900101'),false);assert.equal(Object.hasOwn(revised,'correctionLines'),false);
  const masked=api.sanitizeRecord(record,[[.5,.31,.55,.34]],correctionWords);assert.equal(masked.text,'공개 남은 글자');
});

test('a mask over one part of a corrected multiword line removes the complete effective line',()=>{
  const words=[word('옛 이름',[.1,.2,.25,.25]),word('홍길동',[.26,.2,.4,.25]),word('보존',[.1,.5,.4,.55])];
  const record={words,correctionLines:[{indices:[0,1],box:[.1,.2,.4,.25],text:'성명: 김하나'}]};
  const out=api.sanitizeRecord(record,[[.31,.2,.35,.25]],correctionWords);assert.equal(out.text,'보존');assert.equal(out.words.length,1);
});

test('invalid corrections, coordinates, boxes and non-text separators fail without exposing a partially sanitized record',()=>{
  const record=fixture();record.correctionLines=[{indices:[99],box:record.words[1].box,text:'수정'}];assert.throws(()=>api.sanitizeRecord(record,[],correctionWords),/교정/);
  assert.throws(()=>api.sanitizeRecord(record,[]),/교정/);
  for(const boxes of [null,[[0,0,0,1]],[[-.1,0,.2,.2]],[[0,0,NaN,1]],[[0,0,2,1]]])assert.throws(()=>api.sanitizeRecord(fixture(),boxes,correctionWords),/가리기/);
  assert.throws(()=>api.sanitizeRecord({words:[word('secret',[0,0,0,1])]},[],correctionWords),/위치/);
  assert.throws(()=>api.sanitizeRecord({words:[word('safe',undefined,{separator:'SECRET'})]},[],correctionWords),/구분/);
  assert.throws(()=>api.sanitizeRecord({...fixture(),nativeTextBoxes:[[0,0,0,1]]},[],correctionWords),/검색 텍스트/);
});

test('empty masks still clean stale payloads; an entirely masked page has no searchable OCR text',()=>{
  const record=fixture(),out=api.sanitizeRecord(record,[],correctionWords);assert.equal(out.words.length,3);assert.equal(out.text,'공개 900101-1234567 남은 글자');assert.equal(Object.hasOwn(out,'rawText'),false);
  const removed=api.sanitizeRecord(record,[[0,0,1,1]],correctionWords);assert.deepEqual(removed.words,[]);assert.equal(removed.text,'');
});

test('sanitizer preserves no arbitrary nested metadata or word payload',()=>{
  const record={uid:'one',source:'vision',language:'kor',layout:{leak:'NESTED SECRET'},confidence:NaN,opaque:{secret:'NESTED SECRET'},words:[word('safe',undefined,{blocks:['NESTED SECRET'],symbols:['NESTED SECRET'],confidence:95})]};
  const out=api.sanitizeRecord(record,[],correctionWords);assert.equal(JSON.stringify(out).includes('NESTED SECRET'),false);assert.equal(Object.hasOwn(out,'layout'),false);assert.equal(Object.hasOwn(out,'confidence'),false);
});

test('sanitizer handles a dense OCR page with bounded row lookup',t=>{
  const words=Array.from({length:20000},(_,i)=>{const x=(i%100)*.009,y=Math.floor(i/100)*.004;return word(`word-${i}`,[x,y,x+.005,y+.003]);});
  const boxes=Array.from({length:200},(_,i)=>[.1,i*.004,.2,i*.004+.003]);const start=performance.now(),out=api.sanitizeRecord({words},boxes,correctionWords),elapsed=performance.now()-start;
  assert.ok(out.words.length>0&&out.words.length<words.length);assert.ok(elapsed<3000,`cleanup took ${elapsed.toFixed(1)} ms`);t.diagnostic(`20,000 words / 200 masks: ${elapsed.toFixed(1)} ms on this host`);
});

test('presets store explicit names and preference allowlist only, never candidates, OCR or document identity',()=>{
  const list=api.savePreset([],'계약서 공유용',{types:['rrn','bad','phone','rrn'],style:'partial',candidate:{text:'900101-1234567'},words:[{text:'secret'}],document:'employee.pdf'});
  assert.equal(list.length,1);assert.match(list[0].id,/^custom-/);assert.deepEqual(list[0].types,['rrn','phone']);assert.equal(list[0].style,'partial');assert.deepEqual(Object.keys(list[0]),['id','name','types','style']);
  const restored=api.readPresets(JSON.stringify([{...list[0],candidate:'900101-1234567',ocr:'secret',file:'employee.pdf'}]));assert.deepEqual(restored,list);assert.equal(JSON.stringify(restored).includes('900101'),false);
});

test('same-name save updates preferences in place without mutation; delete returns a clean new list',()=>{
  let list=api.savePreset([],'공유',{types:['rrn'],style:'full'});list=api.savePreset(list,'검토',{types:['phone'],style:'partial'});const original=structuredClone(list),id=list[0].id;
  const updated=api.savePreset(list,'  공유  ',{types:['email'],style:'partial'});assert.equal(updated.length,2);assert.equal(updated[0].id,id);assert.deepEqual(updated[0].types,['email']);assert.deepEqual(list,original);
  assert.deepEqual(api.removePreset(updated,id),[updated[1]]);assert.deepEqual(api.removePreset(updated,'missing'),updated);
});

test('preset limit and name bounds are explicit; existing presets remain editable at the limit',()=>{
  let list=[];for(let i=0;i<8;i++)list=api.savePreset(list,`설정 ${i}`,{types:['phone'],style:'full'});
  assert.equal(list.length,8);assert.throws(()=>api.savePreset(list,'새 설정',{types:['email']}),{code:'PRIVACY_PRESET_LIMIT'});assert.equal(api.savePreset(list,'설정 0',{types:['rrn']}).length,8);
  for(const name of ['',null,'\n\t','가'.repeat(25)])assert.throws(()=>api.savePreset([],name,{types:['phone']}),{code:'PRIVACY_PRESET_NAME'});
  assert.equal(api.savePreset([],'가'.repeat(24),{types:['phone']})[0].name.length,24);assert.throws(()=>api.savePreset([],'설정',{types:[]}),{code:'PRIVACY_PRESET_TYPES'});
});

test('malformed or oversized saved preferences recover safely and cannot create executable fields',()=>{
  for(const raw of [null,undefined,'{','{}','x'.repeat(20001),42])assert.deepEqual(api.readPresets(raw),[]);
  const stored=[{id:'custom-a',name:'유효',types:['phone'],style:'no'}, {id:'numbers',name:'기본 충돌',types:['rrn'],style:'full'},{id:'custom-a',name:'중복 ID',types:['email'],style:'full'},{id:'custom-b',name:'유효',types:['email'],style:'full'},{id:'custom-c',name:'비어 있음',types:['unknown'],style:'full'}];
  assert.deepEqual(api.readPresets(stored),[{id:'custom-a',name:'유효',types:['phone'],style:'full'}]);
  const polluted=JSON.parse('[{"id":"custom-safe","name":"설정","types":["rrn"],"style":"full","__proto__":{"secret":"x"}}]');const read=api.readPresets(polluted);assert.equal(Object.hasOwn(read[0],'__proto__'),false);assert.equal(read[0].secret,undefined);
});
