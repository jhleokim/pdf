// Only non-rendering accessibility properties are removed. This is a PDF token
// scanner, not a regular-expression rewrite of text or image drawing commands.
const hidden=new Set(['ActualText','Alt','E']);
const white=c=>c===0||c===9||c===10||c===12||c===13||c===32;
const delimiter=c=>white(c)||'()<>[]{}/%'.includes(String.fromCharCode(c));
export function stripHiddenProperties(bytes){
  const source=new TextDecoder('latin1').decode(bytes);
  if(!/\/(ActualText|Alt|E)(?=[\x00\s()[\]<>/%])/.test(source.replace(/#([0-9a-f]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)))))return bytes;
  let i=0;const removals=[];
  function skip(){while(i<bytes.length){if(white(bytes[i])){i++;continue;}if(bytes[i]===37){while(i<bytes.length&&bytes[i]!==10&&bytes[i]!==13)i++;continue;}break;}}
  function token(depth=0){
    if(depth>64)throw Error('PDF 속성의 중첩 깊이가 너무 큽니다.');skip();const start=i,c=bytes[i++];
    if(c===undefined)throw Error('PDF 속성이 완전하지 않습니다.');
    if(c===40){let level=1;while(i<bytes.length&&level){const b=bytes[i++];if(b===92){if(bytes[i]===13&&bytes[i+1]===10)i+=2;else i++;}else if(b===40)level++;else if(b===41)level--;}if(level)throw Error('PDF 문자열이 완전하지 않습니다.');return {start,end:i};}
    if(c===60&&bytes[i]!==60){while(i<bytes.length&&bytes[i]!==62)i++;if(i>=bytes.length)throw Error('PDF 문자열이 완전하지 않습니다.');return {start,end:++i};}
    if(c===60&&bytes[i]===60){i++;while(true){skip();if(bytes[i]===62&&bytes[i+1]===62){i+=2;break;}const key=token(depth+1);if(!key.name)throw Error('PDF 속성 이름이 올바르지 않습니다.');const value=token(depth+1);if(hidden.has(key.name))removals.push([key.start,value.end]);}return {start,end:i};}
    if(c===91){while(true){skip();if(bytes[i]===93){i++;break;}token(depth+1);}return {start,end:i};}
    if(c===47){while(i<bytes.length&&!delimiter(bytes[i]))i++;const name=source.slice(start+1,i).replace(/#([0-9a-f]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)));return {start,end:i,name};}
    while(i<bytes.length&&!delimiter(bytes[i]))i++;return {start,end:i,word:source.slice(start,i)};
  }
  while(i<bytes.length){skip();if(i===bytes.length)break;const t=token();
    // Binary inline images have ambiguous EI delimiters. Fail closed instead
    // of interpreting their pixels as PDF syntax and silently damaging a page.
    if(t.word==='BI')throw Error('인라인 이미지와 대체 텍스트가 함께 있는 PDF는 안전한 영역 삭제를 확인할 수 없어 저장하지 않았습니다.');
  }
  if(!removals.length)return bytes;const result=bytes.slice();for(const [a,b]of removals)result.fill(32,a,b);return result;
}
