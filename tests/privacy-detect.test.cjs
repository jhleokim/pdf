const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../src/privacy-detect.js');
const all=api.TYPES.map(type=>type.id),settings=(style='full',types=all)=>({style,types});
const word=(text,box=[.1,.1,.8,.14],extra={})=>({text,box,separator:'\n',...extra});
const record=(text,extra={})=>({source:'paddle-v5',granularity:'line',words:[word(text)],...extra});
const detect=(text,style='full')=>api.detect(record(text),settings(style));
const row=(texts,{top=.1,gap=.003,separators=[],width=.007}={})=>{
  let x=.1;return texts.map((text,i)=>{const b=[x,top,x+text.length*width,top+.02];x=b[2]+gap;return word(text,b,{separator:separators[i]??(i===texts.length-1?'\n':' ')});});
};

test('settings contain selectable types, conservative presets and allow no selected type',()=>{
  assert.equal(api,globalThis.PDFPrivacyDetect);
  assert.deepEqual(api.normalizeSettings(),{types:['rrn','account','card'],style:'full'});
  assert.deepEqual(api.normalizeSettings({types:['bad','phone','rrn','phone'],style:'other'}),{types:['rrn','phone'],style:'full'});
  assert.deepEqual(api.normalizeSettings({types:[],style:'partial'}),{types:[],style:'partial'});
  assert.deepEqual(api.PRESETS.map(p=>p.types),[['rrn','account','card'],['rrn','account','card','phone','email']]);
  assert.ok(api.TYPES.every(t=>t.label&&t.partialLabel));
  assert.equal(Object.isFrozen(api.PRESETS[0].types),true);
});

test('requires actual OCR words and rejects invalid nonempty coordinates without silently dropping a value',()=>{
  for(const input of [null,{},record('900101-1234567',{skipped:true})])assert.throws(()=>api.detect(input),{code:'PRIVACY_DETECT_OCR_REQUIRED'});
  for(const box of [[0,0,0,1],[-.1,0,.5,1],[.1,.1,1.1,.2],[.1,NaN,.3,.4],null])assert.throws(()=>api.detect({words:[word('900101-1234567',box)]}),/위치/);
  assert.deepEqual(api.detect({words:[]}),[]);
});

test('registration numbers validate real dates and discriminator but do not require obsolete checksum rules',()=>{
  for(const text of ['900101-1234567','000229-3234567','040229-7234567','991231 8234567','900101 - 6234567'])assert.equal(detect(text)[0]?.type,'rrn',text);
  for(const text of ['900231-1234567','990229-1234567','001301-3234567','900000-1234567','900101-0234567','900101-9234567','990101-12345678','A900101-1234567','9001O1-1234567'])assert.equal(detect(text).filter(c=>c.type==='rrn').length,0,text);
});

test('whole OCR word gets a bounded ink margin; Paddle lines retain labels and estimate only the matched value',()=>{
  const exact=detect('900101-1234567')[0];assert.equal(exact.approximate,false);assert.ok(exact.boxes[0][0]<.1&&exact.boxes[0][0]>=.098&&exact.boxes[0][2]>.8&&exact.boxes[0][2]<=.802);assert.ok(exact.boxes[0][1]<.1&&exact.boxes[0][3]>.14);assert.equal(exact.maskedText,'******-*******');
  const line=detect('주민등록번호: 900101-1234567 계약금 100원')[0];assert.equal(line.text,'900101-1234567');assert.equal(line.approximate,true);assert.ok(line.boxes[0][0]>.1&&line.boxes[0][2]<.8);assert.match(line.reason,/추정/);
});

test('optional font measurements improve proportional label/value bounds while retaining the review requirement',()=>{
  const text='Resident ID: 900101-1234567',r=record(text),width=s=>[...s].reduce((n,ch)=>n+(/[ilI:]/.test(ch)?3:ch===' '?4:/[0-9]/.test(ch)?10:8),0);
  const measured=api.detect(r,settings(),width)[0],prefix=text.indexOf('900101'),expected=.1+(.8-.1)*width(text.slice(0,prefix))/width(text);
  assert.ok(measured.boxes[0][0]<=expected&&expected-measured.boxes[0][0]<=.00201);assert.ok(measured.boxes[0][2]>=.8&&measured.boxes[0][2]<=.802);assert.equal(measured.approximate,true);
  assert.notEqual(measured.boxes[0][0],api.detect(r,settings())[0].boxes[0][0]);
  assert.deepEqual(api.detect(r,settings(),s=>({width:width(s)})),api.detect(r,settings(),width),'Canvas TextMetrics may be passed directly');
});

test('invalid/unavailable font measurements use the bounded fallback; whole words do not call measurement',()=>{
  const r=record('ID: 900101-1234567'),fallback=api.detect(r,settings());
  for(const callback of [()=>NaN,()=>0,()=>-1,()=>({width:Infinity}),()=>{throw Error('font unavailable');}])assert.deepEqual(api.detect(r,settings(),callback),fallback);
  let called=false;api.detect(record('900101-1234567'),settings(),()=>{called=true;return 1;});assert.equal(called,false);
});

test('Vision/Tesseract segmented registration numbers produce only the corresponding boxes',()=>{
  const words=row(['주민번호:','900101','-','1234567'],{separators:[' ','','','\n']});
  const result=api.detect({source:'vision',granularity:'word',words},settings());assert.equal(result.length,1);assert.equal(result[0].approximate,false);assert.deepEqual(result[0].wordIndices,[1,2,3]);
  for(let i=0;i<3;i++){const box=result[0].boxes[i],original=words[i+1].box;assert.ok(box[0]<=original[0]&&box[2]>=original[2]&&original[0]-box[0]<=.00201&&box[2]-original[2]<=.00201);}
  const partial=api.detect({words},settings('partial'))[0];assert.equal(partial.maskedText,'900101-*******');assert.deepEqual(partial.wordIndices,[3]);assert.equal(partial.approximate,false);assert.equal(partial.boxes.length,1);assert.ok(partial.boxes[0][0]>words[2].box[2]&&partial.boxes[0][0]<=words[3].box[0]);
});

test('do not assemble a number across hard line breaks, distant table columns or backwards reading order',()=>{
  const first=word('900101',[.1,.1,.16,.12],{separator:' '}),second=word('1234567',[.162,.1,.23,.12]);
  assert.equal(api.detect({words:[first,second]},settings()).length,1);
  for(const words of [[{...first,separator:'\n'},second],[first,{...second,box:[.55,.1,.62,.12]}],[first,{...second,box:[.1,.3,.17,.32]}],[second,first]])assert.deepEqual(api.detect({words},settings()),[]);
});

test('phone numbers support Korean regional, mobile and international prefixes without altering OCR digits',()=>{
  const cases=[['010-1234-5678','010-****-5678'],['02-123-4567','02-***-4567'],['031 1234 5678','031 **** 5678'],['+82 10 1234 5678','+82 10 **** 5678'],['+82 2 123 4567','+82 2 *** 4567'],['+8221234567','+822***4567'],['01012345678','010****5678']];
  for(const [text,masked] of cases){const candidates=detect(text,'partial');assert.equal(candidates.length,1,text);assert.equal(candidates[0].type,'phone');assert.equal(candidates[0].maskedText,masked);assert.equal(candidates[0].approximate,true);}
  for(const text of ['010-123-4567','010-1234-56789','O10-1234-5678','2026-09-22','123-456-7890','12021234567'])assert.equal(detect(text).filter(c=>c.type==='phone').length,0,text);
});

test('email recognizes an entire address and hides local-part characters, retaining domain and plus tags',()=>{
  for(const [text,masked] of [['leo.kim@example.com','le*****@example.com'],['a@example.co.kr','*@example.co.kr'],['name+tag@sub.example.org','na******@sub.example.org']]){
    const candidate=detect(text,'partial')[0];assert.equal(candidate.type,'email');assert.equal(candidate.maskedText,masked);assert.equal(candidate.approximate,true);
  }
  for(const text of ['test@domain','test..name@example.com','.name@example.com','name.@example.com','@example.com','abc@example.c'])assert.equal(detect(text).filter(c=>c.type==='email').length,0,text);
  assert.equal(detect('연락처 leo@example.com, 확인')[0].text,'leo@example.com');
});

test('account requires a nearby explicit label, card requires Luhn and repeated digits do not count',()=>{
  assert.deepEqual(detect('123-456-789012'),[]);
  for(const text of ['계좌번호: 123-456-789012','입금계좌 123456789012','계좌번호 하나은행 123-456-789012'])assert.equal(detect(text)[0]?.type,'account',text);
  assert.equal(detect('계좌번호: 123-456-789012','partial')[0].maskedText,'***-***-**9012');
  assert.equal(detect('카드 4111-1111-1111-1111')[0]?.type,'card');
  assert.equal(detect('4111-1111-1111-1111','partial')[0]?.maskedText,'4111-****-****-1111');
  assert.deepEqual(detect('4111-1111-1111-1112'),[]);assert.deepEqual(detect('0000-0000-0000-0000'),[]);
  assert.equal(detect('계좌번호: 4111111111111111')[0]?.type,'account','context has priority over card checksum');
  assert.deepEqual(api.detect(record('계좌번호: 4111111111111111'),settings('full',['card'])),[],'unselected account must not become a card');
});

test('names require a label and mask internal letters; names with two letters retain only the first',()=>{
  for(const [text,expected] of [['성명: 홍길동','홍*동'],['예금주 김수','김*'],['고객명: 남궁민수','남**수'],['성 명 : 김 하 나','김 * 나']]){const candidate=detect(text,'partial')[0];assert.equal(candidate?.type,'name',text);assert.equal(candidate.maskedText,expected);}
  for(const text of ['홍길동 고객입니다','성명 확인','예금주 주식회사','고객명 미기재','홍길동 100원'])assert.equal(detect(text).filter(c=>c.type==='name').length,0,text);
});

test('address proposals preserve field labels and partial style retains administrative area',()=>{
  const text='주소: 서울특별시 강남구 테헤란로 123 101동 203호';
  const candidate=detect(text,'partial')[0];assert.equal(candidate.type,'address');assert.equal(candidate.text,'서울특별시 강남구 테헤란로 123 101동 203호');assert.ok(candidate.maskedText.startsWith('서울특별시 강남구 '));assert.ok(!candidate.maskedText.includes('테헤란로'));assert.equal(candidate.approximate,true);
  assert.deepEqual(detect('서울특별시 강남구 테헤란로 123'),[],'no implicit address label');
  const separate=detect('주소: 서울특별시 강남구 테헤란로 123 전화: 010-1234-5678');assert.deepEqual(separate.map(c=>c.type),['address','phone']);assert.equal(separate[0].text,'서울특별시 강남구 테헤란로 123');
});

test('correction lines replace original content, including complete deletion, without resurrecting sensitive text',()=>{
  const words=row(['900101-1234567','010-1234-5678']);const bounds=[words[0].box[0],.1,words[1].box[2],.12];
  const deleted={words,correctionLines:[{indices:[0,1],text:'확인 완료',box:bounds}]};assert.deepEqual(api.detect(deleted,settings()),[]);
  const empty={words,correctionLines:[{indices:[0],text:'',box:words[0].box}]};const remaining=api.detect(empty,settings());assert.deepEqual(remaining.map(c=>c.type),['phone']);
  const edited={words,correctionLines:[{indices:[0,1],text:'900202-1234567',box:bounds}]};const result=api.detect(edited,settings());assert.equal(result.length,1);assert.equal(result[0].text,'900202-1234567');assert.equal(result[0].approximate,true);assert.deepEqual(result[0].wordIndices,[0,1]);assert.match(result[0].reason,/교정/);
});

test('removed OCR words do not cause unrelated fragments to join into a new registration number',()=>{
  const words=row(['900101','삭제','1234567'],{width:.003,gap:.002});
  const r={words,correctionLines:[{indices:[1],text:'',box:words[1].box}]};assert.deepEqual(api.detect(r,settings()),[]);
});

test('invalid, overlapping or stale correction metadata aborts the whole detection instead of using stale text',()=>{
  const words=[word('900101-1234567')],valid={indices:[0],box:words[0].box,text:'900202-1234567'};
  for(const correctionLines of [{},[{...valid,indices:[1]}],[{...valid,indices:[0,0]}],[{...valid,box:[.1,.1,.7,.14]}],[valid,valid],[{...valid,text:'수정\n두 줄'}]])assert.throws(()=>api.detect({words,correctionLines},settings()),{code:'PRIVACY_DETECT_CORRECTION'});
});

test('does not mutate OCR records or caller settings',()=>{
  const r={words:row(['성명:','홍길동','전화:','010-1234-5678'])},s=settings('partial'),before=structuredClone({r,s});api.detect(r,s);assert.deepEqual({r,s},before);
});

test('word, text and candidate limits report explicitly and never silently truncate',()=>{
  assert.throws(()=>api.detect({words:Array.from({length:50001},()=>word('내용'))},settings()),{code:'PRIVACY_DETECT_LIMIT'});
  assert.throws(()=>api.detect(record('x'.repeat(60001)),settings()),{code:'PRIVACY_DETECT_LIMIT'});
  assert.throws(()=>api.detect({words:Array.from({length:10},()=>word('x'.repeat(51000)))},settings()),{code:'PRIVACY_DETECT_LIMIT'});
  assert.throws(()=>api.detect({words:Array.from({length:2001},()=>word('900101-1234567'))},settings()),{code:'PRIVACY_DETECT_LIMIT'});
});

test('large structured page stays bounded and finds all non-overlapping known patterns',t=>{
  const words=Array.from({length:20000},(_,i)=>word(i%100===0?'010-1234-5678':`계약 항목 ${i}`)),start=performance.now(),candidates=api.detect({words},settings()),ms=performance.now()-start;
  assert.equal(candidates.length,200);assert.equal(candidates.every(c=>c.type==='phone'),true);assert.ok(ms<3000,`20,000 words took ${ms.toFixed(1)} ms`);t.diagnostic(`20,000 OCR words: ${ms.toFixed(1)} ms on this host`);
});
