const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../src/privacy-detect.js');
const settings={types:api.TYPES.map(t=>t.id),style:'full'};
const record=text=>({words:[{text,box:[.05,.1,.95,.13],separator:'\n'}]});

test('nonmatching label plus 60,000 characters of whitespace stays bounded on repeated finds',t=>{
  for(const label of ['계좌번호','성명','주소']){
    const input=record(label+' '.repeat(60000-label.length-1)+'X'),times=[];
    for(let pass=0;pass<3;pass++){
      const start=performance.now(),result=api.detect(input,settings),ms=performance.now()-start;times.push(ms);
      assert.deepEqual(result,[],'empty labelled fields must not become privacy candidates');
      // This wide budget catches the former multi-second quadratic backtrack,
      // not small timing differences between shared CI or developer machines.
      assert.ok(ms<1200,`${label}: 60,000-character negative took ${ms.toFixed(1)} ms`);
    }
    t.diagnostic(`${label}, three finds: ${times.map(n=>n.toFixed(1)).join(', ')} ms`);
  }
});

test('colon grouping preserves accepted labels, optional delimiters and horizontal spacing',()=>{
  for(const [label,value,type] of [
    ['계좌번호','123-456-789012','account'],['계좌 번호','하나은행 123-456-789012','account'],
    ['입금 계좌','123-456-789012','account'],['account','123-456-789012','account'],
    ['성명','홍길동','name'],['성\t명','김 하 나','name'],['고객명','홍길동 (인)','name'],
    ['주소','서울특별시 중구 시험로 123 101동 202호','address'],['주 소','서울특별시 중구 시험로 123','address']
  ])for(const separator of ['', ' ', '\t', ' : ', '\t：\t', '   :\t   ']){
    const result=api.detect(record(label+separator+value),settings);
    if(label==='account'&&!separator){assert.deepEqual(result,[],'Latin letters directly against a number retain the existing numeric boundary rule');continue;}
    assert.equal(result.length,1,label+JSON.stringify(separator)+value);assert.equal(result[0].type,type);
    if(type==='account')assert.equal(result[0].text,'123-456-789012');
    assert.ok(!result[0].text.includes(label),'the field label is preserved');
  }
});

test('long horizontal spacing with a real value retains classification and privacy text',()=>{
  for(const [label,value,type] of [['계좌번호','123-456-789012','account'],['성명','홍길동','name'],['주소','서울특별시 중구 시험로 123','address']]){
    for(const delimiter of [' ', ' : ', '\t：\t']){
      const result=api.detect(record(label+' '.repeat(10000)+delimiter+'\t'.repeat(10000)+value),settings);
      assert.equal(result.length,1);assert.equal(result[0].type,type);assert.equal(result[0].text,value);assert.ok(result[0].approximate);
    }
  }
});

test('unselected types cannot hide a performance regression or change classification priority',()=>{
  const negative=record('계좌번호'+' '.repeat(59000)+'X'),start=performance.now();
  assert.deepEqual(api.detect(negative,{types:['email'],style:'full'}),[]);assert.ok(performance.now()-start<1200);
  const account=record('계좌번호  :\t4111111111111111');
  assert.deepEqual(api.detect(account,{types:['card'],style:'full'}),[]);
  assert.equal(api.detect(account,settings)[0].type,'account');
});

test('an excessively merged OCR region aborts before unbounded canvas work instead of returning approximate partial results',()=>{
  const input=record('전화: 010-1234-5678; '.repeat(1000));let chars=0,calls=0;
  assert.throws(()=>api.detect(input,settings,text=>{chars+=text.length;calls++;return text.length;}),error=>error.code==='PRIVACY_DETECT_LIMIT'&&/영역을 나눠/.test(error.message));
  assert.ok(calls>0);assert.ok(chars<=1000000,`${chars} characters reached the callback`);
});

test('measurement limits propagate through fallback handling, including failed font callbacks',()=>{
  const input=record('전화: 010-1234-5678; '.repeat(1000));
  assert.throws(()=>api.detect(input,settings,()=>NaN),{code:'PRIVACY_DETECT_LIMIT'});
  assert.throws(()=>api.detect(record('성명: 홍길동'),settings,()=>{const error=Error('work budget exceeded');error.code='PRIVACY_DETECT_LIMIT';throw error;}),{code:'PRIVACY_DETECT_LIMIT'});
});

test('the measurement budget resets for each page and preserves normal full/partial geometry',()=>{
  const longPage=record('x'.repeat(8000)+'전화: 010-1234-5678; '.repeat(12));
  for(let page=0;page<3;page++){
    let measuredChars=0;assert.equal(api.detect(longPage,settings,text=>{measuredChars+=text.length;return text.length;}).length,12);
    assert.ok(measuredChars>500000&&measuredChars<1000000,'each page uses more than half the budget, so retaining a previous page counter would fail');
  }
  const fixture=require('./data/privacy-ocr-layout-synthetic.json');
  for(let pass=0;pass<3;pass++)for(const page of fixture.pages)for(const style of ['full','partial']){
    let chars=0;
    const measured=api.detect(page.record,{...settings,style},text=>{chars+=text.length;return text.length;});
    assert.equal(measured.length,page.expected.length);assert.ok(chars<1000000);
    assert.deepEqual(measured.map(c=>`${c.type}:${c.text.replace(/\s/g,'')}`).sort(),page.expected.map(c=>`${c.type}:${c.value.replace(/\s/g,'')}`).sort());
  }
});
