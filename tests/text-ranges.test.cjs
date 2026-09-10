const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/markup-text.js'),'utf8')+';this.T=PDFMarkupText;',ctx);const T=ctx.T,plain=value=>JSON.parse(JSON.stringify(value));
const a={text:'한글 ABC 검토',bold:false,boldRanges:[]};
test('bold toggles only the selected range and a collapsed selection targets the entire box',()=>{
 const part={...a,...T.toggleBold(a,3,6)};assert.deepEqual(plain(part.boldRanges),[{start:3,end:6}]);assert.equal(part.bold,false);
 assert.deepEqual(plain(T.toggleBold(part,3,6)),{bold:false,boldRanges:[]});assert.deepEqual(plain(T.toggleBold(part,2,2)),{bold:true,boldRanges:[]});
 assert.deepEqual(plain(T.toggleBold({...a,bold:true},4,4)),{bold:false,boldRanges:[]});
});
test('mixed selection becomes bold and toggling inside a bold box preserves both sides',()=>{
 const part={...a,...T.toggleBold({...a,bold:true},3,6)};assert.deepEqual(plain(part.boldRanges),[{start:0,end:3},{start:6,end:9}]);
 assert.deepEqual(plain(T.toggleBold(part,2,7)),{bold:true,boldRanges:[]});
});
test('insertions and replacements retain nearby bold style without shifting unrelated text',()=>{
 const part={...a,boldRanges:[{start:3,end:6}]};
 assert.deepEqual(plain(T.remapBold(part,'앞 '+a.text)),{bold:false,boldRanges:[{start:5,end:8}]});
 assert.deepEqual(plain(T.remapBold(part,'한글 AXBC 검토',{text:a.text,start:4,end:4})),{bold:false,boldRanges:[{start:3,end:7}]});
 assert.deepEqual(plain(T.remapBold(part,'한글 검토',{text:a.text,start:3,end:7})),{bold:false,boldRanges:[]});
});
test('repeated characters use the actual edit location instead of a longest-prefix guess',()=>{
 const part={text:'aaaa',bold:false,boldRanges:[{start:2,end:3}]};
 assert.deepEqual(plain(T.remapBold(part,'aaaaa',{text:'aaaa',start:0,end:0})).boldRanges,[{start:3,end:4}]);
});
test('normalizing tabs and combining characters maps formatting offsets into the cleaned text',()=>{
 const part={text:'A\tCafe\u0301',bold:false,boldRanges:[{start:2,end:7}]};T.cleanBold(part);
 assert.equal(part.text,'A    Café');assert.deepEqual(plain(part.boldRanges),[{start:5,end:9}]);
});
test('wrapped lines retain source offsets across spaces, newlines and repeated text',()=>{
 const font={unitsPerEm:1,ascent:.8,descent:-.2,hasGlyphForCodePoint:()=>true,glyphForCodePoint:()=>({advanceWidth:1}),layout:text=>({glyphs:[...text].map(()=>({advanceWidth:1}))})};
 const layout=T.layout(font,'AB CD EF\nAB CD',1,1.3,5);assert.deepEqual(plain(layout.lines),['AB','CD EF','AB CD']);assert.deepEqual(plain(layout.offsets),[0,3,9]);
 const runs=T.lineRuns({text:'AB CD EF\nAB CD',bold:false,boldRanges:[{start:3,end:7}],textLayout:layout},1);
 assert.deepEqual(plain(runs).map(r=>[r.text,r.bold,r.x,r.width]),[['CD E',true,0,4],['F',false,4,1]]);
});
