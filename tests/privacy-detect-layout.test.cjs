const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../src/privacy-detect.js');
const fixtures=require('./data/privacy-ocr-layout-synthetic.json');
const types=api.TYPES.map(t=>t.id),settings={types,style:'full'};
const word=(text,box,separator='\n')=>({text,box,separator});
const detect=(words,extra={})=>api.detect({source:'vision',granularity:'word',words,...extra},settings);
const normalize=text=>text.replace(/\s/g,'');
const pair=(label,value)=>[word(label,[.05,.1,.15,.12]),word(value,[.27,.1,.47,.12])];

for(const fixture of fixtures.pages)test(`actual synthetic OCR: ${fixture.fixture} page ${fixture.page} has every expected value and no extra candidate`,()=>{
  const before=structuredClone(fixture.record),candidates=api.detect(fixture.record,settings);
  const actual=candidates.map(c=>`${c.type}:${normalize(c.text)}`).sort();
  const expected=fixture.expected.map(c=>`${c.type}:${normalize(c.value)}`).sort();
  assert.deepEqual(actual,expected);assert.deepEqual(fixture.record,before);
  for(const c of candidates){assert.ok(c.wordIndices.length>0);assert.ok(c.boxes.length>0);}
});

test('Vision colon overlap and skew retain the label but recognize the adjacent value',()=>{
  const words=[word('계좌',[.06627,.22205,.11019,.24058],''),word('번호',[.11098,.22029,.15333,.23882],''),word(':',[.15215,.22,.15921,.23705],' '),word('123-456-789012',[.16823,.21264,.35176,.23676])];
  const result=detect(words);assert.equal(result.length,1);assert.equal(result[0].type,'account');assert.deepEqual(result[0].wordIndices,[3]);
  assert.ok(result[0].boxes.every(b=>b[0]>words[2].box[2]),'the account label and colon remain outside the suggested mask');
  const name=[word('성명',[.06745,.55382,.10862,.57],''),word(':',[.10431,.55382,.11647,.57],' '),word('홍길동',[.12392,.55382,.18823,.57])];
  assert.deepEqual(detect(name).map(c=>[c.type,c.text,c.wordIndices]),[['name','홍길동',[2]]]);
});

test('punctuation tolerance does not join overlapping number boxes or deeply overlapping punctuation',()=>{
  const numbers=[word('900101',[.1,.1,.2,.12],' '),word('1234567',[.19,.1,.3,.12])];
  assert.deepEqual(detect(numbers),[]);
  const deep=[word('성명',[.1,.1,.15,.12],''),word(':',[.12,.1,.155,.12],' '),word('홍길동',[.17,.1,.24,.12])];
  assert.deepEqual(detect(deep),[]);
});

test('table field links preserve OCR word coordinates and exclude labels',()=>{
  for(const [label,value,type] of [['계좌번호','123-456-789012','account'],['성 명','홍길동','name'],['주소','서울특별시 중구 시험로 123 101동 202호','address']]){
    const words=pair(label,value),result=detect(words);assert.equal(result.length,1,label);assert.equal(result[0].type,type);assert.equal(result[0].text,value);assert.deepEqual(result[0].wordIndices,[1]);assert.match(result[0].reason,/같은 행/);
    assert.ok(result[0].boxes.every(b=>b[0]>words[0].box[2]),'label remains visible');
  }
});

test('geometry finds a unique same-row value even when OCR reading order visits another row first',()=>{
  const [label,value]=pair('계좌번호','123-456-789012');
  const result=detect([label,word('공개 안내',[.05,.2,.3,.22]),value]);
  assert.deepEqual(result.map(c=>[c.type,c.text,c.wordIndices]),[['account','123-456-789012',[2]]]);
});

test('ambiguous table rows never guess between two plausible values',()=>{
  for(const [label,left,right] of [['계좌번호','123-456-789012','222-333-444444'],['성명','홍길동','김하나']]){
    const words=[word(label,[.03,.1,.1,.12]),word(left,[.16,.1,.24,.12]),word(right,[.27,.1,.35,.12])];
    assert.deepEqual(detect(words),[],label);
  }
});

test('an intervening cell, wrong row, remote column, or prose label prevents contextual linking',()=>{
  const [label,value]=pair('계좌번호','123-456-789012');
  for(const words of [
    [label,word('입력값 확인',[.17,.1,.25,.12]),value],
    [label,{...value,box:[.27,.14,.47,.16]}],
    [label,{...value,box:[.5,.1,.7,.12]}],
    [{...label,text:'계좌번호 확인'},value],
    [{...label,text:'다음 계좌번호'},value],
    [{...label,text:'계약금액'},value],
    [label,{...value,box:[.01,.1,.04,.12]}]
  ])assert.deepEqual(detect(words),[]);
});

test('two independently labelled fields on the same row each retain their own value',()=>{
  const words=[word('계좌번호',[.04,.1,.1,.12]),word('123-456-789012',[.18,.1,.29,.12]),word('성명',[.31,.1,.35,.12]),word('홍길동',[.4,.1,.45,.12])];
  assert.deepEqual(detect(words).map(c=>[c.type,c.text,c.wordIndices]),[['account','123-456-789012',[1]],['name','홍길동',[3]]]);
});

test('context linking never combines numeric fragments from separate table cells',()=>{
  const words=[word('계좌번호',[.03,.1,.1,.12]),word('123-456',[.16,.1,.22,.12]),word('789012',[.27,.1,.33,.12])];
  assert.deepEqual(detect(words),[]);
  assert.deepEqual(detect([word('900101',[.05,.1,.15,.12]),word('1234567',[.27,.1,.47,.12])]),[]);
});

test('an account label retains classification priority over a valid card checksum',()=>{
  const words=pair('계좌번호','4111111111111111');
  assert.deepEqual(detect(words).map(c=>c.type),['account']);
  assert.deepEqual(api.detect({words},{types:['card'],style:'full'}),[]);
  assert.deepEqual(api.detect({words:pair('계좌번호','01012345678')},{types:['phone'],style:'full'}),[]);
});

test('table fields allow only the narrow bank prefix and signature-marker suffix',()=>{
  for(const [label,value,type,expected] of [
    ['계좌번호','하나은행 123-456-789012','account','123-456-789012'],
    ['계좌번호','NH농협은행 123-456-789012','account','123-456-789012'],
    ['성명','홍길동 (인)','name','홍길동'],
    ['성명','홍길동(서명)','name','홍길동']
  ]){
    const candidates=detect(pair(label,value));assert.equal(candidates.length,1,value);assert.equal(candidates[0].type,type);assert.equal(candidates[0].text,expected);assert.deepEqual(candidates[0].wordIndices,[1]);
  }
  for(const [label,value] of [
    ['계좌번호','입금 안내 123-456-789012'],['계좌번호','하나은행 123-456-789012 확인'],
    ['성명','홍길동 담당자'],['성명','홍길동 (인) 확인'],['성명','홍길동 (서명란)'],['성명','홍길동 김하나']
  ])assert.deepEqual(detect(pair(label,value)),[],value);
});

test('a separate nearby colon is a label delimiter, never a value or a distant cell bridge',()=>{
  const label=word('성명',[.1,.1,.14,.125]),colon=word(':',[.145,.1,.15,.125]),value=word('홍길동',[.25,.1,.31,.125]);
  const result=detect([label,colon,value]);assert.deepEqual(result.map(c=>[c.type,c.text,c.wordIndices]),[['name','홍길동',[2]]]);
  assert.deepEqual(detect([label,{...colon,box:[.2,.1,.205,.125]},value]),[],'a colon far from the label cannot jump an empty cell');
  assert.deepEqual(detect([label,{...colon,text:'확인'},value]),[],'non-delimiter text blocks the association');
  assert.deepEqual(detect([label,colon,value],{correctionLines:[{indices:[1],box:colon.box,text:''}]}),[],'a deleted delimiter is a correction barrier');
});

test('deleted or replaced corrections cannot resurrect an old table value or label',()=>{
  const words=pair('계좌번호','123-456-789012');
  for(const [index,text] of [[0,''],[0,'공개 항목'],[1,''],[1,'확인 완료']])assert.deepEqual(detect(words,{correctionLines:[{indices:[index],box:words[index].box,text}]}),[]);
  const changed=detect(words,{correctionLines:[{indices:[1],box:words[1].box,text:'222-333-444444'}]});
  assert.deepEqual(changed.map(c=>c.text),['222-333-444444']);assert.ok(changed[0].approximate);
});

test('deleting an intervening OCR cell does not make its neighboring value belong to a label',()=>{
  const [label,value]=pair('계좌번호','123-456-789012'),middle=word('삭제한 셀',[.17,.1,.25,.12]);
  const words=[label,middle,value];
  assert.deepEqual(detect(words,{correctionLines:[{indices:[1],box:middle.box,text:''}]}),[]);
  assert.deepEqual(detect([label,{...middle,text:''},value]),[]);
});

test('non-contiguous correction lines cannot bridge across another deleted correction',()=>{
  const words=[word('원래',[.1,.1,.16,.125],' '),word('삭제',[.161,.1,.17,.125],' '),word('내용',[.171,.1,.18,.125],' '),word('1234567',[.182,.1,.25,.125])];
  const correctionLines=[{indices:[0,2],text:'900101',box:[.1,.1,.18,.125]},{indices:[1],text:'',box:words[1].box}];
  assert.deepEqual(detect(words,{correctionLines}),[]);
});

test('overlapping dense OCR rows fail explicitly within the bounded neighbor budget',()=>{
  const words=[word('계좌번호',[.01,.1,.1,.12]),...Array.from({length:10000},()=>word('공개 항목',[.2,.1,.3,.12]))];
  assert.throws(()=>detect(words),{code:'PRIVACY_DETECT_LIMIT'});
  assert.deepEqual(api.detect({words},{types:['rrn','email'],style:'full'}),[],'unselected unrelated labels must not trigger spatial work or its limits');
});

test('20,000-word structured input remains bounded with real contextual labels',t=>{
  const words=[];
  for(let row=0;row<100;row++){
    const y=.005+row*.009;words.push(word('성명',[.01,y,.025,y+.003]),word('홍길동',[.03,y,.05,y+.003]));
    for(let col=0;col<198;col++){const x=.055+col*.0043;words.push(word(`일반 항목 ${col}`,[x,y,x+.002,y+.003]));}
  }
  const start=performance.now(),result=detect(words),elapsed=performance.now()-start;
  assert.equal(result.length,100);assert.ok(result.every(c=>c.type==='name'&&c.text==='홍길동'));assert.ok(elapsed<3000,`20,000 words took ${elapsed.toFixed(1)} ms`);t.diagnostic(`20,000 words with 100 table labels: ${elapsed.toFixed(1)} ms`);
});
