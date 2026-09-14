const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/ocr-tables.js'),'utf8'),context=vm.createContext({performance});vm.runInContext(source,context);const api=context.PDFOCRTables;
const plain=value=>JSON.parse(JSON.stringify(value));
const word=(text,box,extra={})=>({text,box,confidence:96,...extra});
function raster(width=600,height=800){return {width,height,data:new Uint8ClampedArray(width*height*4).fill(255)};}
function line(image,x0,y0,x1,y1,{color=25,thickness=1}={}){
  const count=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));
  for(let i=0;i<=count;i++){const x=Math.round(x0+(x1-x0)*i/Math.max(1,count)),y=Math.round(y0+(y1-y0)*i/Math.max(1,count));for(let dy=0;dy<thickness;dy++)for(let dx=0;dx<thickness;dx++)if(x+dx>=0&&x+dx<image.width&&y+dy>=0&&y+dy<image.height){const at=((y+dy)*image.width+x+dx)*4;image.data[at]=image.data[at+1]=image.data[at+2]=color;}}
}
function grid({merged=false,width=600,height=800,angle=0}={}){
  const image=raster(width,height),xs=[60,220,380,540],ys=[100,220,340,460,580],cos=Math.cos(angle),sin=Math.sin(angle);
  const draw=(x0,y0,x1,y1)=>{const turn=(x,y)=>[(x-300)*cos-(y-350)*sin+300,(x-300)*sin+(y-350)*cos+350];line(image,...turn(x0,y0),...turn(x1,y1));};
  for(const y of ys)draw(xs[0],y,xs.at(-1),y);
  xs.forEach((x,i)=>draw(x,merged&&i>0&&i<xs.length-1?ys[1]:ys[0],x,ys.at(-1)));
  return {image,x:xs.map(v=>v/width),y:ys.map(v=>v/height)};
}

test('bordered grid restores all empty cells and exact normalized geometry',()=>{
  const {image,x,y}=grid(),words=[word('계약금',[.12,.30,.26,.35]),word('1,250,000',[.39,.30,.55,.35])],before=structuredClone(words),out=api.detect(image,{words});
  assert.equal(out.tables.length,1);const table=out.tables[0];assert.equal(table.cells.length,12);assert.deepEqual(plain(table.x),x);assert.deepEqual(plain(table.y),y);
  assert.equal(table.cells.filter(cell=>cell.text==='').length,10);assert.equal(table.cells.find(cell=>cell.row===1&&cell.col===1).text,'1,250,000');assert.deepEqual(words,before);assert.equal(table.reviewed,false);
});

test('missing interior boundaries produce a rectangular merged header without extra empty columns',()=>{
  const {image}=grid({merged:true}),words=[word('계약 내용 및 금액',[.15,.17,.83,.22])],out=api.detect(image,{words}),table=out.tables[0];
  assert.equal(table.cells.length,10);assert.equal(table.cells[0].colSpan,3);assert.equal(table.cells[0].rowSpan,1);assert.equal(table.cells[0].text,words[0].text);assert.deepEqual(plain(table.unassignedIndices),[]);assert.match(api.toHTML(table),/colspan="3"/);
});

test('visible ink in an OCR-missed merged title is flagged while truly blank cells and dust remain blank',()=>{
  const {image}=grid({merged:true});
  for(let x=110;x<290;x+=24){line(image,x,145,x+12,145,{thickness:2});line(image,x,145,x,177,{thickness:2});line(image,x,177,x+12,177,{thickness:2});}
  line(image,280,280,280,280); // One dust pixel in an otherwise blank cell.
  const table=api.detect(image,{words:[]}).tables[0],title=table.cells[0];
  assert.equal(title.text,'');assert.equal(title.colSpan,3);assert.ok(title.reasons.includes('unrecognized-ink'));assert.equal(title.needsReview,true);assert.ok(title.inkBox);
  assert.ok(table.cells.slice(1).every(cell=>cell.text===''&&!cell.reasons.includes('unrecognized-ink')));
  const refreshed=api.refresh(table,[]);assert.ok(refreshed.cells[0].reasons.includes('unrecognized-ink'),'rerender must retain possible OCR omission');
  refreshed.cells[0].text='사용자가 확인한 제목';refreshed.cells[0].edited=true;const corrected=api.refresh(refreshed,[]);assert.equal(corrected.cells[0].text,'사용자가 확인한 제목');assert.ok(!corrected.cells[0].reasons.includes('unrecognized-ink'));
  const recognized=api.refresh(table,[word('인식된 제목',[.17,.175,.50,.23])]);assert.ok(!recognized.cells[0].reasons.includes('unrecognized-ink'));assert.equal(recognized.cells[0].text,'인식된 제목');
});

test('an L-shaped absence does not fabricate a rectangular merged cell',()=>{
  const image=raster(600,800),xs=[60,220,380],ys=[100,220,340];
  for(const y of [ys[0],ys[2]])line(image,60,y,380,y);for(const x of [xs[0],xs[2]])line(image,x,100,x,340);
  line(image,220,220,220,340);line(image,220,220,380,220);
  const out=api.detect(image,{words:[]}),table=out.tables[0];assert.ok(table);assert.equal(table.cells.length,4);assert.ok(table.issues.includes('nonrectangular-merge'));assert.ok(table.cells.some(cell=>cell.needsReview));
});

test('whole PP-OCR lines crossing columns stay intact and prevent silent incomplete export',()=>{
  const words=[word('김하나 1,250,000원',[.12,.2,.85,.25])],table=api.fromGrid({x:[.1,.5,.9],y:[.1,.4],words});
  assert.deepEqual(plain(table.unassignedIndices),[0]);assert.equal(table.cells.reduce((count,cell)=>count+cell.wordIndices.length,0),0);assert.equal(words[0].text,'김하나 1,250,000원');assert.throws(()=>api.toTSV(table),/인식 영역/);
  const merged=api.merge(table,table.cells.map(cell=>cell.id),words);assert.equal(merged.cells[0].text,words[0].text);assert.deepEqual(plain(merged.unassignedIndices),[]);assert.equal(api.toTSV(merged),'김하나 1,250,000원\t');
});

test('substantial overlap accepts OCR jitter but does not use a misleading box center',()=>{
  const words=[word('경미한 오차',[.3,.2,.51,.3]),word('경계 걸침',[.46,.35,.59,.4]),word('외부 글줄',[.01,.45,.2,.49])],table=api.fromGrid({x:[.1,.5,.9],y:[.1,.6],words});
  assert.deepEqual(plain(table.cells[0].wordIndices),[0]);assert.deepEqual(plain(table.unassignedIndices),[1,2]);assert.equal(table.cells[1].text,'');
});

test('adjacent narrow columns remain separate and text rows retain Korean separators and emoji',()=>{
  const words=[word('이',[.101,.11,.108,.13],{separator:''}),word('름',[.1085,.11,.116,.13],{separator:'\n'}),word('😀',[.105,.15,.115,.17]),word('값',[.122,.11,.129,.13])],table=api.fromGrid({x:[.1,.12,.14],y:[.1,.2],words});
  assert.equal(table.cells[0].text,'이름\n😀');assert.equal(table.cells[1].text,'값');assert.deepEqual(plain(table.unassignedIndices),[]);
});

test('manual boundary adjustment retains merged topology and explicit edits with invalidated review',()=>{
  const words=[word('원본',[.15,.2,.25,.3]),word('이동',[.52,.2,.59,.3])],initial=api.fromGrid({x:[.1,.5,.9],y:[.1,.5,.9],words});
  let table=api.merge(initial,['r1c0','r1c1'],words);table.cells[0].text='교정한 성명';table.cells[0].edited=true;table.reviewed=true;
  const moved=api.moveBoundary(table,'x',1,.65,words);assert.equal(moved.cells.find(cell=>cell.id==='r1c0').colSpan,2);assert.equal(moved.cells[0].text,'교정한 성명');assert.ok(moved.cells[0].reasons.includes('edited-cell-remapped'));assert.ok(api.refresh(moved,words).cells[0].reasons.includes('edited-cell-remapped'),'A rerender must not hide changed-source warning');assert.equal(moved.reviewed,false);assert.equal(table.x[1],.5);assert.throws(()=>api.moveBoundary(table,'x',1,.99,words),/경계/);
});

test('unchanged refresh preserves review, while changed OCR text invalidates it',()=>{
  const words=[word('홍길동',[.2,.2,.4,.3])],table=api.fromGrid({x:[.1,.9],y:[.1,.5],words});table.reviewed=true;
  assert.equal(api.refresh(table,words).reviewed,true);const changed=api.refresh(table,[{...words[0],text:'홍길둥'}]);assert.equal(changed.reviewed,false);assert.equal(changed.cells[0].text,'홍길둥');assert.equal(table.cells[0].text,'홍길동');
});

test('splitting recovers source positions and refuses to invent locations for edited merged text',()=>{
  const words=[word('이름',[.15,.2,.3,.3]),word('금액',[.6,.2,.8,.3])],table=api.fromGrid({x:[.1,.5,.9],y:[.1,.5],words}),merged=api.merge(table,['r0c0','r0c1'],words),split=api.split(merged,'r0c0',words);
  assert.deepEqual(plain(split.cells.map(cell=>cell.text)),['이름','금액']);merged.cells[0].edited=true;merged.cells[0].text='새 이름과 금액';assert.throws(()=>api.split(merged,'r0c0',words),/수정한 병합 셀/);
});

test('crossing text requires a deliberate per-word confirmation and keeps an audit of source text',()=>{
  const words=[word('홍길동 500,000',[.2,.2,.8,.3])];let table=api.fromGrid({x:[.1,.5,.9],y:[.1,.5],words});table.cells[0].text='홍길동';table.cells[0].edited=true;table.cells[1].text='500,000';table.cells[1].edited=true;
  assert.throws(()=>api.toTSV(table),/인식 영역/);table=api.resolveWord(table,0,words);assert.equal(table.resolutions[0].text,'홍길동 500,000');assert.equal(api.toTSV(table),'홍길동\t500,000');
  table.reviewed=true;assert.equal(api.refresh(table,words).reviewed,true);
  const changed=api.refresh(table,[{...words[0],text:'홍길동 500,001'}]);assert.deepEqual(plain(changed.resolvedIndices),[]);assert.equal(changed.reviewed,false);assert.throws(()=>api.toTSV(changed),/인식 영역/);
  assert.deepEqual(plain(api.moveBoundary(table,'x',1,.55,words).resolvedIndices),[]);assert.throws(()=>api.toTSV(api.unresolveWord(table,0)),/인식 영역/);
});

test('a later cell text edit invalidates the old crossing-line confirmation',()=>{
  const words=[word('가 나',[.2,.2,.8,.3])];let table=api.fromGrid({x:[.1,.5,.9],y:[.1,.5],words});for(const cell of table.cells){cell.edited=true;cell.text='확인';}table=api.resolveWord(table,0,words);table.cells[1].text='';
  const refreshed=api.refresh(table,words);assert.equal(refreshed.resolvedIndices.length,0);assert.throws(()=>api.toHTML(refreshed),/인식 영역/);
});

test('plain paragraphs, underlines and tilted grids do not silently become structured tables',()=>{
  const blank=raster();for(let y=80;y<680;y+=40)for(let x=50;x<540;x+=15){line(blank,x,y,x+6,y);line(blank,x,y,x,y+10);line(blank,x+6,y,x+6,y+10);}
  assert.equal(api.detect(blank,{words:[]}).tables.length,0);
  const underline=raster();for(let y=100;y<600;y+=100)line(underline,60,y,540,y);assert.equal(api.detect(underline,{words:[]}).tables.length,0);
  const tilted=api.detect(grid({angle:Math.PI/60}).image,{words:[]});assert.equal(tilted.tables.length,0);assert.ok(tilted.warnings.length);
});

test('analysis is limited to the requested page region using full-page normalized coordinates',()=>{
  const {image,x,y}=grid(),out=api.detect(image,{region:[.08,.10,.95,.80],words:[]});assert.equal(out.tables.length,1);assert.deepEqual(plain(out.tables[0].x),x);assert.deepEqual(plain(out.tables[0].y),y);
  const outside=api.detect(image,{region:[0,.8,1,1],words:[]});assert.equal(outside.tables.length,0);
});

test('oversized input and geometry fail visibly without returning a truncated table',()=>{
  const oversized=api.detect({width:1601,height:1,data:new Uint8ClampedArray(6404)},{words:[]});assert.equal(oversized.tables.length,0);assert.match(oversized.warnings.join(' '),/1,600/);
  const words=Array(20001).fill(word('가',[.1,.1,.2,.2]));assert.throws(()=>api.fromGrid({x:[0,1],y:[0,1],words}),/20,000/);const out=api.detect(raster(1,1),{words});assert.equal(out.tables.length,0);assert.match(out.warnings[0],/20,000/);
  assert.throws(()=>api.fromGrid({x:Array.from({length:31},(_,i)=>i/30),y:Array.from({length:22},(_,i)=>i/21)}),/600/);
  assert.throws(()=>api.fromGrid({x:Array.from({length:78},(_,i)=>i/77),y:[0,.5,1]}),/80/);
  assert.throws(()=>api.fromGrid({x:[0,.5,.5,1],y:[0,1]}),/경계/);
});

test('more than twelve tables rejects the run instead of silently returning the first twelve',()=>{
  const image=raster(700,1550);for(let i=0;i<13;i++){const y=20+i*115;for(const x of [40,220,400])line(image,x,y,x,y+70);for(const yy of [y,y+70])line(image,40,yy,400,yy);}
  const out=api.detect(image,{words:[]});assert.equal(out.tables.length,0);assert.match(out.warnings.join(' '),/12개/);
});

test('export preserves blanks and quotes tabs/newlines; HTML escapes text and declares spreadsheet text format',()=>{
  const table=api.fromGrid({x:[0,.5,1],y:[0,.5,1]});table.cells[0].text='00123456789012345678';table.cells[1].text='<img src=x onerror="alert(1)">';table.cells[2].text='가\t나\n"다"';
  const tsv=api.toTSV(table),html=api.toHTML(table);assert.ok(tsv.startsWith('00123456789012345678\t'));assert.ok(tsv.includes('"가\t나\n""다"""\t'));assert.match(html,/mso-number-format:'\\@'/);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
});

test('formula injection is neutralized for plain, whitespace and invisible prefixes while negative amounts remain intact',()=>{
  const table=api.fromGrid({x:[0,1],y:[0,1]});
  for(const value of ['=SUM(A1:A2)','+cmd','-cmd','@SUM(A1)','\t=1+1','\u0001=1+1','\u200b=1+1']){table.cells[0].text=value;const text=api.toTSV(table);assert.ok(text.startsWith("'")||text.startsWith('"\''),JSON.stringify(value));assert.ok(api.toHTML(table).includes('&#39;'));}
  for(const value of ['-50,000','-0.5','-.5','0','00123','2026-09-14']){table.cells[0].text=value;assert.equal(api.toTSV(table),value);}
});

test('1500 positioned words map without duplicates within the 600-cell browser work bound',t=>{
  const x=Array.from({length:21},(_,i)=>.05+i*.045),y=Array.from({length:31},(_,i)=>.03+i*.03),words=[];
  for(let i=0;i<1500;i++){const cell=i%600,r=Math.floor(cell/20),c=cell%20,lineAt=Math.floor(i/600);words.push(word(`항목${i}`,[x[c]+.003,y[r]+.002+lineAt*.008,x[c+1]-.003,y[r]+.008+lineAt*.008]));}
  const start=performance.now(),table=api.fromGrid({x,y,words}),elapsed=performance.now()-start,indices=table.cells.flatMap(cell=>cell.wordIndices);assert.equal(indices.length,1500);assert.equal(new Set(indices).size,1500);assert.equal(table.unassignedIndices.length,0);assert.equal(table.cells.length,600);t.diagnostic(`1500-word / 600-cell mapping: ${elapsed.toFixed(1)} ms on this test host (not a device guarantee)`);assert.ok(elapsed<5000,'bounded mapping unexpectedly exceeded five seconds');
});
