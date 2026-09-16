const test=require('node:test'),assert=require('node:assert/strict'),S=require('../src/document-source.js');
const doc=(name,count=2,kind='pdf')=>({name,count,kind,color:'#008579'});
test('source identity survives baked backing documents, reordering and blank insertion',()=>{
 const docs=new Map([['a',doc('계약서.pdf')],['b',doc('첨부.pdf',1)],['blank',doc('빈 페이지',1,'blank')]]);
 const pages=[{docId:'a',srcIndex:1},{docId:'b',srcIndex:0},{docId:'blank',srcIndex:0}];
 const sources=pages.map(p=>S.page(p,docs));assert.ok(sources.every(Object.isFrozen));
 const merged=pages.map((p,i)=>({...p,docId:'baked',srcIndex:i}));docs.clear();docs.set('baked',doc('통합_편집본.pdf',3));
 assert.equal(S.page(merged[0],docs).name,'계약서.pdf');assert.equal(S.page(merged[0],docs).index,1);
 assert.equal(S.filename(merged,docs),'통합_편집본');
 assert.equal(S.filename([merged[2],merged[0]],docs),'계약서_편집본');
 assert.equal(S.filename([merged[2]],docs),'새문서');
 assert.deepEqual(S.groups([merged[0],merged[0]],docs).map(s=>[s.id,s.used,s.count]),[['a',2,2]]);
 assert.equal(S.filename([],docs),'새문서');
});
test('identical filenames imported separately remain distinct original documents',()=>{
 const docs=new Map([['a',doc('계약서.PDF')],['b',doc('계약서.PDF')]]);
 const pages=[{docId:'a',srcIndex:0},{docId:'b',srcIndex:0}];
 assert.equal(S.filename(pages,docs),'통합_편집본');assert.equal(S.filename([pages[0]],docs),'계약서_편집본');
 assert.throws(()=>S.page({docId:'missing'},docs),/원본 출처/);
});
