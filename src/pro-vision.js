/* Cloud Vision uses its own server key and explicit document-transmission consent. */
(() => {
  function normalize(data){
    const invalid=()=>{throw new Error('Google Vision의 텍스트 또는 위치 정보가 올바르지 않습니다.');};
    if(typeof data.text!=='string'||data.text.length>60000||!Array.isArray(data.words)||data.words.length>10000)invalid();
    let chars=0;
    const words=data.words.map(word=>{
      const box=word?.box;
      if(typeof word?.text!=='string'||!word.text.trim()||word.text.length>2000||/[\u0000-\u0008\u000b-\u001f]/.test(word.text)||!Array.isArray(box)||box.length!==4||!box.every(n=>Number.isFinite(n)&&n>=0&&n<=1)||box[2]<=box[0]||box[3]<=box[1]||!['',' ','\n'].includes(word.separator)||word.confidence!==null&&(!Number.isFinite(word.confidence)||word.confidence<0||word.confidence>100))invalid();
      chars+=word.text.length;if(chars>60000)invalid();
      return {text:word.text,box,separator:word.separator,confidence:word.confidence};
    });
    if(data.text.trim()&&!words.length)invalid();
    const scores=words.filter(w=>Number.isFinite(w.confidence));
    return {text:data.text,words,confidence:scores.length?scores.reduce((sum,w)=>sum+w.confidence,0)/scores.length:null,source:'vision',model:'DOCUMENT_TEXT_DETECTION/builtin/latest',granularity:'word'};
  }
  globalThis.PDFVision=createCloudOCRClient('Google Vision','/api/ocr/vision','vision',normalize);
})();
