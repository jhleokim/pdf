/* Immutable provenance is separate from the PDF currently backing a page. */
(function(root){
 function page(p,docs){
  if(p.source)return p.source;
  const d=docs.get(p.docId);if(!d)throw Error('페이지의 원본 출처를 확인하지 못했습니다.');
  return p.source=Object.freeze({id:p.docId,name:d.name,index:p.srcIndex,count:d.count,kind:d.kind,color:d.color});
 }
 function groups(pages,docs){
  const found=new Map();for(const p of pages){const s=page(p,docs);if(!found.has(s.id))found.set(s.id,{...s,used:0});found.get(s.id).used++;}return [...found.values()];
 }
 function filename(pages,docs){
  const sources=groups(pages,docs).filter(s=>s.kind!=='blank');
  if(!sources.length)return '새문서';
  if(sources.length>1)return '통합_편집본';
  return sources[0].name.replace(/\.[^.]+$/,'')+'_편집본';
 }
 root.PDFSource={page,groups,filename};if(typeof module!=='undefined')module.exports=root.PDFSource;
})(globalThis);
