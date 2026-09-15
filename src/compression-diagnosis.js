'use strict';
let compressionCheckToken=0;
let compressionSources='';
function scheduleCompressionDiagnosis(){const key=[...docs.keys()].join(',');if($('compressionSection').open&&key!==compressionSources){compressionSources=key;void diagnoseCompression();}}
async function diagnoseCompression(){
  const host=$('compressionDiagnosis'),token=++compressionCheckToken;if(!pages.length){host.textContent='';return;}
  host.textContent='압축 가능한 이미지 확인 중…';
  try{
    let images=0,eligible=0,total=0,bytes=0;
    for(const id of new Set(pages.map(p=>p.docId))){const source=docs.get(id);if(!source)continue;
      const report=source.compressionAnalysis||await PDFPro.analyzeDocument(await PDFLib.PDFDocument.load(source.libBytes));source.compressionAnalysis=report;
      if(token!==compressionCheckToken)return;images+=report.images;eligible+=report.eligible;total+=report.totalBytes;bytes+=report.eligibleBytes;
    }
    host.textContent=!images?'이미지가 없는 문서입니다. 이미지 압축으로 줄일 용량이 없습니다.':!eligible?'원본 이미지 '+images+'개 · 이 형식은 화질 보존 압축 대상이 아닙니다.':`원본 이미지 ${images}개 중 ${eligible}개 압축 가능 · 이미지 데이터의 ${Math.round(bytes/Math.max(1,total)*100)}%`;
  }catch(_){if(token===compressionCheckToken)host.textContent='압축 가능 범위는 결과를 만들 때 확인합니다.';}
}
$('compressionSection').addEventListener('toggle',()=>{if($('compressionSection').open)void diagnoseCompression();});
