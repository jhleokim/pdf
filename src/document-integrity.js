/* Read-only preflight. PDF signatures are detected, never claimed to be verified. */
(function(root){
  'use strict';
  function inspect(doc){
    const P=root.PDFLib,N=P.PDFName.of,seen=new Set();
    const report={signatures:0,forms:0,bookmarks:0,attachments:0,actions:0,metadata:false};
    const resolve=v=>v instanceof P.PDFRef?doc.context.lookup(v):v;
    function visit(value){
      const v=resolve(value);if(!v||seen.has(v))return;seen.add(v);
      if(v instanceof P.PDFArray){for(let i=0;i<v.size();i++)visit(v.get(i));return;}
      const d=v instanceof P.PDFRawStream?v.dict:v;if(!(d instanceof P.PDFDict))return;
      if(String(d.get(N('FT')))==='/Sig'||d.has(N('ByteRange')))report.signatures++;
      if(String(d.get(N('Subtype')))==='/Widget')report.forms++;
      if(d.has(N('Title'))&&(d.has(N('Dest'))||d.has(N('A'))))report.bookmarks++;
      if(String(d.get(N('Type')))==='/Filespec'||String(d.get(N('Subtype')))==='/FileAttachment')report.attachments++;
      if(d.has(N('JS'))||['/JavaScript','/Launch','/SubmitForm','/ImportData'].includes(String(d.get(N('S')))))report.actions++;
      for(const [,child]of d.entries())visit(child);
    }
    visit(doc.catalog);report.metadata=doc.catalog.has(N('Metadata'))||!!doc.context.trailerInfo.Info;
    return report;
  }
  function warnings(report,{restructured=false,redacted=false}={}){
    const result=[];
    if(report.signatures)result.push('전자서명이 포함되어 있습니다. 편집본은 기존 서명의 유효성을 유지하지 못합니다. 원본을 별도로 보관하세요.');
    if(restructured&&(report.forms||report.bookmarks))result.push('페이지 삭제·병합 시 입력 양식 또는 북마크가 유지되지 않을 수 있습니다. 저장 후 확인하세요.');
    if(redacted)result.push('개인정보를 영구 삭제하기 위해 전체 문서를 이미지 PDF로 저장합니다. 검색·복사·입력 양식·링크와 첨부파일은 제거됩니다.');
    return result;
  }
  root.PDFDocumentIntegrity={inspect,warnings};
  if(typeof module!=='undefined')module.exports=root.PDFDocumentIntegrity;
})(globalThis);
