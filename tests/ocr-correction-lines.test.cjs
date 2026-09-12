const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ocr-correction-lines.js'),'utf8'),context);const api=context.PDFOCRLines;
const plain=value=>JSON.parse(JSON.stringify(value));
const word=(text,x,y=.1,separator=' ')=>({text,box:[x,y,x+.06,y+.02],separator,confidence:95,meta:{id:text}});
const record=()=>({source:'vision',uid:'one',key:'original',granularity:'word',words:[word('첫째',.1),word('둘째',.164),word('셋째',.228,.1,'\n')]});
const draft=value=>({original:structuredClone([value]),records:structuredClone([value])});
test('groups adjacent same-row words, preserves source order, and honors hard line breaks',()=>{
  const r=record();r.words.push(word('새줄',.1,.125,'\n'),word('표',.5,.125,' '),word('값',.65,.125,'\n'));
  assert.deepEqual(plain(api.group(r)),[{indices:[0,1,2]},{indices:[3]},{indices:[4]},{indices:[5]}]);
});
test('column gutters, overlapping boxes, different rows and invalid geometry remain separate',()=>{
  for(const next of [word('다른열',.6),word('중첩',.15),word('다른행',.164,.15),{text:'위치없음'}])assert.equal(api.group({words:[word('원본',.1),next]}).length,2);
  assert.deepEqual(plain(api.group({words:[word('뒤',.5),word('앞',.1)]})),[{indices:[0]},{indices:[1]}]);
});
test('Vision punctuation and subpixel Korean box overlap stay with their text line',()=>{
  const r={source:'vision',words:[
    {text:'내용',box:[.1,.1,.14,.12],separator:''},
    {text:',',box:[.1402,.117,.142,.122],separator:' '},
    {text:'다',box:[.15,.101,.161,.121],separator:''},
    {text:'음',box:[.1607,.102,.172,.121],separator:' '},
    {text:'항목',box:[.177,.103,.207,.12],separator:''},
    {text:'.',box:[.207,.118,.209,.122],separator:'\n'}
  ]};
  assert.deepEqual(plain(api.group(r)),[{indices:[0,1,2,3,4,5]}]);
  r.words[3].box[0]=.15;assert.ok(api.group(r).length>1,'Substantial overlap was incorrectly merged');
});
test('line engines retain their existing OCR lines and skipped records have no editable group',()=>{
  for(const extra of [{granularity:'line'},{source:'paddle-v5'},{source:'gemini'}])assert.deepEqual(plain(api.group({...record(),...extra})),[{indices:[0]},{indices:[1]},{indices:[2]}]);
  assert.deepEqual(plain(api.group({...record(),skipped:true})),[]);
});
test('layout maps exact UTF-16 selection offsets including emoji and separating spaces',()=>{
  const r={words:[word('가😀',.1,.1,''),word('나',.2,.1,'  '),word('끝',.3,.1,'\n')]};
  assert.deepEqual(plain(api.layout(r,{indices:[0,1,2]})),{text:'가😀나  끝',ranges:[{index:0,start:0,end:3},{index:1,start:3,end:4},{index:2,start:6,end:7}]});
});
test('a single word correction leaves unchanged words, separators and every coordinate intact',()=>{
  const r=record(),d=draft(r),line=api.group(r)[0];assert.equal(api.update(d,0,line,'첫째 수정한말 셋째').text,'첫째 수정한말 셋째');
  assert.deepEqual(d.records[0].words[0],r.words[0]);assert.deepEqual(d.records[0].words[2],r.words[2]);assert.equal(d.records[0].words[1].text,'수정한말');
  for(let i=0;i<3;i++)assert.deepEqual(d.records[0].words[i].box,r.words[i].box);
  assert.deepEqual(d.original[0],r);assert.equal(d.records[0].source,'vision');
});
test('whitespace insertions/deletions and attached suffixes do not redistribute unchanged words',()=>{
  const r=record(),d=draft(r),line=api.group(r)[0];
  api.update(d,0,line,'첫째둘째 셋째');assert.equal(d.records[0].words[0].text,'첫째');assert.equal(d.records[0].words[0].separator,'');assert.equal(d.records[0].words[1].text,'둘째');
  api.update(d,0,line,'첫째  둘째 셋째');assert.equal(d.records[0].words[0].separator,'  ');assert.equal(d.records[0].words[1].text,'둘째');
  api.update(d,0,line,'첫째! 둘째 셋째');assert.equal(d.records[0].words[0].text,'첫째!');assert.deepEqual(d.records[0].words[1],r.words[1]);
});
test('insertion between words uses the neighboring slot while keeping unaffected words exact',()=>{
  const r=record(),d=draft(r),line=api.group(r)[0];
  assert.equal(api.update(d,0,line,'첫째 새로 둘째 셋째').text,'첫째 새로 둘째 셋째');
  assert.deepEqual(d.records[0].words[0],r.words[0]);assert.equal(d.records[0].words[1].text,'새로 둘째');assert.deepEqual(d.records[0].words[2],r.words[2]);
});
test('Korean composition, emoji, complete deletion and exact undo keep the fixed word slots',()=>{
  const r=record(),d=draft(r),line=api.group(r)[0];
  for(const value of ['첫째 ㄷ 셋째','첫째 두 셋째','첫째 둘😀째 셋째','',' ','완전히 다른 문장 🧾'])assert.equal(api.update(d,0,line,value).text,value);
  assert.equal(d.records[0].words.length,3);api.update(d,0,line,'첫째 둘째 셋째');assert.deepEqual(d.records[0],r);
});
test('only the edited line changes; its final newline is retained and pasted newlines normalize',()=>{
  const r=record();r.words.push(word('다음',.1,.2,'\n'));const d=draft(r),line=api.group(r)[0];
  assert.equal(api.update(d,0,line,'첫째\r\n둘째 셋째').text,'첫째 둘째 셋째');assert.equal(d.records[0].words[2].separator,'\n');assert.deepEqual(d.records[0].words[3],r.words[3]);
});
test('bounded replacement handles long pasted text without quadratic allocation',()=>{
  const r={words:[word('A'.repeat(1500),.1,.1,' '),word('B'.repeat(1500),.17,.1,'\n')]},d=draft(r),line={indices:[0,1]},text='C'.repeat(25000)+'😀';
  assert.equal(api.update(d,0,line,text).text,text);assert.equal(d.records[0].words.length,2);assert.deepEqual(d.records[0].words[0].box,r.words[0].box);
  assert.equal(api.update(d,0,line,api.layout(r,line).text).text,api.layout(r,line).text);assert.deepEqual(d.records[0],r);
  assert.throws(()=>api.update(d,0,line,'D'.repeat(60001)),/60,000/);
});
test('major rewrites mark the union line for export instead of stretching the first word box',()=>{
  const r=record(),d=draft(r),line=api.group(r)[0],text='완전히 새로운 이름과 금액 12,345원';
  api.update(d,0,line,text);assert.equal(d.records[0].correctionLines.length,1);
  const meta=d.records[0].correctionLines[0];assert.deepEqual(plain(meta.indices),[0,1,2]);assert.equal(meta.text,text);assert.deepEqual(plain(meta.box),[.1,.1,.28800000000000003,.12000000000000001]);
  for(let index=0;index<3;index++)assert.deepEqual(d.records[0].words[index].box,r.words[index].box);
  api.update(d,0,line,'첫째 둘째 셋째');assert.equal(d.records[0].correctionLines,undefined);
  api.update(d,0,line,'첫째 둘째 셋째!');assert.equal(d.records[0].correctionLines,undefined);
});
test('existing approximated lines remain grouped on reopening, and undo restores their prior metadata',()=>{
  const r=record(),first=draft(r),line=api.group(r)[0];api.update(first,0,line,'새 텍스트');const saved=structuredClone(first.records[0]),second=draft(saved);
  assert.deepEqual(plain(api.group(saved)),[{indices:[0,1,2]}]);api.update(second,0,line,'다시 쓴 내용');assert.equal(second.records[0].correctionLines[0].text,'다시 쓴 내용');
  api.update(second,0,line,'새 텍스트');assert.deepEqual(plain(second.records[0]),plain(saved));
});
test('mixed edits reconstruct exact Unicode text without mutating the recognition or losing slots',()=>{
  const r=record(),original=structuredClone(r),line=api.group(r)[0],symbols=['가','나','A','😀',' ','!',','];let seed=1741;
  const random=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
  for(let turn=0;turn<250;turn++){
    const d=draft(r),chars=[...api.layout(r,line).text];for(let edit=0;edit<1+random(7);edit++){const at=random(chars.length+1),operation=random(3);if(operation===0)chars.splice(at,0,symbols[random(symbols.length)]);else if(operation===1)chars.splice(at,1);else chars.splice(at,1,symbols[random(symbols.length)]);}
    const text=chars.join('');assert.equal(api.update(d,0,line,text).text,text,'Round trip failed for '+JSON.stringify(text));assert.equal(d.records[0].words.length,3);assert.deepEqual(d.original[0],original);
    for(let index=0;index<3;index++)assert.deepEqual(d.records[0].words[index].box,r.words[index].box);
  }
});

test('a tall page keeps normal horizontal spaces together without merging column gutters',()=>{
  const r={source:'vision',words:[
    {text:'계약',box:[.1,.1,.127,.106],separator:' '},
    {text:'내용',box:[.134,.1,.161,.106],separator:' '},
    {text:'다른열',box:[.5,.1,.54,.106],separator:'\n'}
  ]};
  assert.deepEqual(plain(api.group(r)),[{indices:[0,1]},{indices:[2]}]);
});

test('minor edits, deletions and tabs keep the same editable line after Apply and reopen',()=>{
  const r=record(),d=draft(r),line=api.group(r)[0];
  api.update(d,0,line,'첫째 둘째');assert.deepEqual(plain(api.group(d.records[0])),[{indices:[0,1,2]}]);
  const reopened=draft(d.records[0]);api.update(reopened,0,line,'첫째\t수정');assert.equal(api.layout(reopened.records[0],line).text,'첫째 수정');
  assert.deepEqual(plain(api.group(reopened.records[0])),[{indices:[0,1,2]}]);
  api.update(d,0,line,'첫째 둘째 셋째');assert.deepEqual(d.records[0],r);
});
