/* Local, review-first suggestions over OCR text. No document leaves the browser. */
(function(root){
  'use strict';
  const TYPES=Object.freeze([
    {id:'rrn',label:'주민·외국인등록번호',partialLabel:'뒤 7자리'},
    {id:'account',label:'계좌번호',partialLabel:'끝 4자리만 유지'},
    {id:'card',label:'카드번호',partialLabel:'처음·끝 4자리 유지'},
    {id:'phone',label:'전화번호',partialLabel:'가운데 번호'},
    {id:'email',label:'이메일',partialLabel:'아이디 일부'},
    {id:'name',label:'이름',partialLabel:'이름 가운데'},
    {id:'address',label:'주소',partialLabel:'상세 주소'}
  ].map(Object.freeze));
  const PRESETS=Object.freeze([
    {id:'numbers',name:'번호 중심',types:Object.freeze(['rrn','account','card']),style:'full'},
    {id:'contact',name:'연락처 포함',types:Object.freeze(['rrn','account','card','phone','email']),style:'full'}
  ].map(Object.freeze));
  const MAX_WORDS=50000,MAX_CHARS=500000,MAX_RUN=60000,MAX_CANDIDATES=2000,MAX_ROW_NEIGHBORS=256,MAX_ROW_CHECKS=250000,MAX_MEASURE_CHARS=1000000;
  function fail(message,code='PRIVACY_DETECT_INVALID'){const e=new Error(message);e.code=code;throw e;}
  function normalizeSettings(value={}){
    const types=Array.isArray(value?.types)?value.types:PRESETS[0].types;
    return {types:TYPES.map(type=>type.id).filter(id=>types.includes(id)),style:value?.style==='partial'?'partial':'full'};
  }
  const validBox=b=>Array.isArray(b)&&b.length===4&&b.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&b[2]>b[0]&&b[3]>b[1];
  const validQuad=q=>{
    if(!Array.isArray(q)||q.length!==4||!q.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1)))return false;
    let direction=0;
    for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(cross)<1e-12||direction&&Math.sign(cross)!==direction)return false;direction=Math.sign(cross);}
    return true;
  };
  const union=boxes=>boxes.reduce((a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])],[1,1,0,0]);
  function tokensFor(record){
    if(!record||record.skipped||!Array.isArray(record.words))fail('이 페이지의 텍스트를 먼저 인식해 주세요.','PRIVACY_DETECT_OCR_REQUIRED');
    const words=record.words;
    if(words.length>MAX_WORDS)fail('한 페이지의 인식 영역이 너무 많습니다. 페이지나 인식 범위를 나누어 주세요.','PRIVACY_DETECT_LIMIT');
    let chars=0;
    for(const word of words){
      if(!word||typeof word.text!=='string')fail('인식 텍스트 형식을 확인하지 못했습니다. 텍스트를 다시 인식해 주세요.');
      chars+=word.text.length;
      if(chars>MAX_CHARS||word.text.length>MAX_RUN)fail('한 페이지의 인식 텍스트가 너무 큽니다. 인식 범위를 나누어 주세요.','PRIVACY_DETECT_LIMIT');
      if(word.text.trim()&&!validBox(word.box))fail('인식 텍스트의 위치가 올바르지 않습니다. 텍스트를 다시 인식해 주세요.');
    }
    const covered=new Set(),replacements=new Map(),corrections=record.correctionLines;
    if(corrections!==undefined){
      const invalid=()=>fail('OCR 교정 글줄의 위치를 확인하지 못했습니다. 교정 내용을 다시 확인해 주세요.','PRIVACY_DETECT_CORRECTION');
      if(!Array.isArray(corrections)||corrections.length>words.length)invalid();
      for(const line of corrections){
        if(!line||!Array.isArray(line.indices)||!line.indices.length||typeof line.text!=='string'||line.text.length>MAX_RUN||/[\u0000-\u001f\u007f\u2028\u2029]/.test(line.text)||!validBox(line.box))invalid();
        chars+=line.text.length;if(chars>MAX_CHARS)fail('교정 텍스트가 너무 큽니다. 인식 범위를 나누어 주세요.','PRIVACY_DETECT_LIMIT');
        const indices=[...line.indices].sort((a,b)=>a-b),local=new Set();
        for(const index of indices){if(!Number.isInteger(index)||index<0||index>=words.length||local.has(index)||covered.has(index)||!validBox(words[index].box))invalid();local.add(index);}
        const bounds=union(indices.map(index=>words[index].box));
        if(bounds.some((v,i)=>Math.abs(v-line.box[i])>1e-6))invalid();
        for(const index of indices)covered.add(index);
        replacements.set(indices[0],{text:line.text,box:[...line.box],separator:words[indices.at(-1)].separator??'\n',indices,corrected:true});
      }
    }
    const result=[];let contextEpoch=0;
    words.forEach((word,index)=>{
      if(replacements.has(index)){const replacement=replacements.get(index);if(replacement.text.trim())result.push({...replacement,contextEpoch});else contextEpoch++;}
      else if(!covered.has(index)){
        if(word.text.trim())result.push({text:word.text,box:[...word.box],separator:word.separator??' ',indices:[index],corrected:!!word.corrected,contextEpoch,granularity:record.granularity,source:record.source,...(validQuad(word.quad)?{quad:word.quad.map(p=>[...p])}:{})});
        else contextEpoch++;
      }
    });
    return result;
  }
  function sameRow(a,b){
    if(a.contextEpoch!==b.contextEpoch)return false;
    if(a.indices.at(-1)+1!==b.indices[0])return false;
    if(/[\r\n\u2028\u2029]/.test(a.separator))return false;
    const x=a.box,y=b.box,ha=x[3]-x[1],hb=y[3]-y[1],height=Math.min(ha,hb),overlap=Math.min(x[3],y[3])-Math.max(x[1],y[1]);
    const punctuationA=/^[\p{P}\p{S}]+$/u.test(a.text),punctuationB=/^[\p{P}\p{S}]+$/u.test(b.text),punctuation=punctuationA||punctuationB;
    if(punctuation){const large=ha>=hb?x:y,small=ha>=hb?y:x,center=(small[1]+small[3])/2,h=Math.max(ha,hb);if(center<large[1]-.15*h||center>large[3]+.25*h)return false;}
    else if(overlap<height*.55||Math.max(ha,hb)>height*2||Math.abs(x[1]+x[3]-y[1]-y[3])>height*1.3)return false;
    // Vision sometimes gives a colon a slightly overlapping box. Permit only
    // a small fraction of that punctuation box, never two overlapping values.
    const overlapLimit=punctuation?Math.max(.001,Math.min(.006,(punctuationA?x[2]-x[0]:y[2]-y[0])*.5)):.001;
    if(y[0]<x[0]||y[0]-x[2]<-overlapLimit)return false;
    const glyphA=(x[2]-x[0])/Math.max(1,a.text.length),glyphB=(y[2]-y[0])/Math.max(1,b.text.length);
    // Never join distant table columns merely because they have the same y.
    return y[0]-x[2]<=Math.min(.045,Math.max(glyphA,glyphB)*2.5);
  }
  function runsFor(tokens){
    const runs=[];let current,previous;
    for(const token of tokens){
      const separator=previous?String(previous.separator).replace(/[^\t ]/g,'').slice(0,2):'';
      if(!current||!sameRow(previous,token)||current.text.length+separator.length+token.text.length>MAX_RUN){current={text:'',segments:[]};runs.push(current);}
      else current.text+=separator;
      const start=current.text.length;current.text+=token.text;current.segments.push({...token,start,end:current.text.length});previous=token;
    }
    return runs;
  }
  const FIELD_LABELS=[
    ['account',/^(?:계좌[ \t]*번호|입금[ \t]*계좌|출금[ \t]*계좌|환급[ \t]*계좌|계좌|account)[ \t]*[:：]?$/i],
    ['name',/^(?:성[ \t]*명|예금주|고객명|계약자|채무자|채권자|신청인|수취인)[ \t]*[:：]?$/],
    ['address',/^(?:주[ \t]*소|소재지|거주지)[ \t]*[:：]?$/]
  ];
  const fieldType=text=>text.length<=24?FIELD_LABELS.find(([,pattern])=>pattern.test(text.trim()))?.[0]:undefined;
  function fieldRow(a,b){
    const height=Math.min(a.height,b.height),overlap=Math.min(a.box[3],b.box[3])-Math.max(a.box[1],b.box[1]);
    return Math.max(a.height,b.height)<=height*2&&overlap>=height*.5&&Math.abs(a.center-b.center)<=Math.max(a.height,b.height)*.55;
  }
  function linkedField(label,value){
    if(value.run.text.length>180||label.epoch!==value.epoch)return null;
    const prefix=label.run.text+' ',text=prefix+value.run.text;
    // A whole, independently recognized value is required. Never manufacture
    // an account or a name by joining fragments from separate table cells.
    const complete=hitsFor(text).some(hit=>{
      if(hit.type!==label.type||hit.start<prefix.length)return false;
      const before=text.slice(prefix.length,hit.start).trim(),after=text.slice(hit.end).trim();
      if(before&&!(label.type==='account'&&/^[가-힣A-Za-z]{1,12}(?:은행|증권)$/.test(before)))return false;
      return !after||label.type==='name'&&/^\((?:인|서명)\)$/.test(after);
    });
    if(!complete)return null;
    return {text,segments:[...label.run.segments,...value.run.segments.map(s=>({...s,start:s.start+prefix.length,end:s.end+prefix.length}))],contextLinked:true};
  }
  function contextRunsFor(runs,enabled){
    const needed=new Set(enabled);
    // Account context must still disambiguate a value that also passes the
    // card checksum or phone pattern, even if account masking is unchecked.
    if(needed.has('card')||needed.has('phone'))needed.add('account');
    if(!runs.some(run=>needed.has(fieldType(run.text))))return runs;
    const entries=runs.map((run,index)=>{
      const box=union(run.segments.map(s=>s.box));
      return {run,index,box,center:(box[1]+box[3])/2,height:box[3]-box[1],type:fieldType(run.text),epoch:run.segments[0].contextEpoch};
    });
    const rows=[...entries].sort((a,b)=>a.center-b.center),links=new Map();let checks=0;
    function firstAt(y){let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].center<y)lo=mid+1;else hi=mid;}return lo;}
    for(const label of entries){
      if(!needed.has(label.type))continue;
      const radius=label.height*1.1,near=[];let count=0;
      for(let i=firstAt(label.center-radius);i<rows.length&&rows[i].center<=label.center+radius;i++){
        if(++count>MAX_ROW_NEIGHBORS||++checks>MAX_ROW_CHECKS)fail('같은 행의 인식 영역이 너무 많습니다. 인식 범위를 나누어 확인해 주세요.','PRIVACY_DETECT_LIMIT');
        const value=rows[i],gap=value.box[0]-label.box[2],colon=/^[ \t]*[:：][ \t]*$/.test(value.run.text),overlap=colon?Math.min(.006,(value.box[2]-value.box[0])*.5):.001;
        if(value.index!==label.index&&value.box[0]>=label.box[0]&&gap>=-overlap&&gap<=.24&&fieldRow(label,value))near.push(value);
      }
      near.sort((a,b)=>a.box[0]-b.box[0]||a.index-b.index);
      let anchor=label,colon;
      if(near[0]&&/^[ \t]*[:：][ \t]*$/.test(near[0].run.text)){
        colon=near.shift();
        if(colon.epoch!==label.epoch||colon.box[0]-label.box[2]>Math.min(.025,label.height*.75)||colon.box[2]-colon.box[0]>label.height*.8)continue;
        const offset=label.run.text.length+1;
        anchor={...label,run:{text:label.run.text+' '+colon.run.text,segments:[...label.run.segments,...colon.run.segments.map(s=>({...s,start:s.start+offset,end:s.end+offset}))]}};
      }
      const value=near[0];if(!value||value.type)continue;
      const linked=linkedField(anchor,value);if(!linked)continue;
      // Stop at the next explicit field. Two possible values, overlapping
      // cells, or an intervening text cell make the association ambiguous.
      let ambiguous=false;
      for(let i=1;i<near.length;i++){
        if(near[i].type)break;
        if(near[i].box[0]<value.box[2]-.001||linkedField(anchor,near[i])){ambiguous=true;break;}
      }
      if(ambiguous)continue;
      const candidates=links.get(value.index)||[];candidates.push({label,value,linked,colon});links.set(value.index,candidates);
    }
    const replacements=new Map(),consumed=new Set();
    for(const candidates of links.values())if(candidates.length===1){const {label,value,linked,colon}=candidates[0];replacements.set(label.index,linked);consumed.add(value.index);if(colon)consumed.add(colon.index);}
    return runs.flatMap((run,index)=>consumed.has(index)?[]:[replacements.get(index)||run]);
  }
  const digitPositions=text=>{const out=[];for(let i=0;i<text.length;i++)if(text[i]>='0'&&text[i]<='9')out.push(i);return out;};
  const digits=text=>text.replace(/[^0-9]/g,'');
  function rrnValid(value){
    const v=digits(value);if(v.length!==13||!/[1-8]/.test(v[6]))return false;
    const year=(/[3478]/.test(v[6])?2000:1900)+Number(v.slice(0,2)),month=Number(v.slice(2,4)),day=Number(v.slice(4,6));
    if(month<1||month>12||day<1)return false;
    const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    return day<=days[month-1];
  }
  function cardValid(value){
    const v=digits(value);if(v.length<13||v.length>19||/^([0-9])\1+$/.test(v))return false;
    let sum=0,double=false;for(let i=v.length-1;i>=0;i--){let n=Number(v[i]);if(double){n*=2;if(n>9)n-=9;}sum+=n;double=!double;}return sum%10===0;
  }
  const addressValid=v=>v.length>=6&&v.length<180&&/(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|[가-힣]{2,10}(?:시|군|구))/.test(v)&&/[가-힣0-9]+(?:로|길|동|읍|면|리|구)(?:\s|[0-9]|$)/.test(v);
  const numericBoundary=(text,start,end)=>!/[0-9A-Za-z]/.test(text[start-1]||'')&&!/[0-9A-Za-z]/.test(text[end]||'');
  function hitsFor(text){
    const hits=[];
    function scan(type,pattern,accept,reason){
      for(const match of text.matchAll(pattern)){
        const value=match.groups?.value??match[0],start=match.index+match[0].lastIndexOf(value),end=start+value.length;
        if(accept&&!accept(value,start,end))continue;
        hits.push({type,text:value,start,end,reason});
        if(hits.length>MAX_CANDIDATES*2)fail('개인정보 후보가 너무 많습니다. 페이지나 인식 범위를 나누어 확인해 주세요.','PRIVACY_DETECT_LIMIT');
      }
    }
    scan('rrn',/[0-9](?:[ \t-]{0,3}[0-9]){12}/g,(v,s,e)=>numericBoundary(text,s,e)&&rrnValid(v),'등록번호 형식과 생년월일을 확인했습니다.');
    scan('email',/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?){1,5}/g,(v,s,e)=>!/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~@-]/.test(text[s-1]||'')&&!/[A-Za-z0-9@_-]/.test(text[e]||'')&&/\.[A-Za-z]{2,63}$/.test(v)&&!v.slice(0,v.indexOf('@')).startsWith('.')&&!v.slice(0,v.indexOf('@')).endsWith('.')&&!v.includes('..'),'이메일 형식을 확인했습니다.');
    scan('account',/(?:^|[\s:：;|,()[\]])(?:계좌[ \t]*번호|입금[ \t]*계좌|출금[ \t]*계좌|환급[ \t]*계좌|계좌|account)[ \t]*(?:[:：][ \t]*)?(?:[가-힣A-Za-z]{1,12}(?:은행|증권)[ \t]+)?(?<value>[0-9][0-9 \t-]{7,40}[0-9])/gi,(v,s,e)=>{const n=digits(v).length;return n>=10&&n<=16&&numericBoundary(text,s,e);},'계좌 라벨 옆의 번호입니다.');
    scan('card',/[0-9](?:[ \t-]{0,3}[0-9]){12,18}/g,(v,s,e)=>numericBoundary(text,s,e)&&cardValid(v),'카드번호 길이와 검증 숫자를 확인했습니다.');
    scan('phone',/(?:\+82[ \t-]{0,3}(?:10|11|16|17|18|19|2|[3-6][1-5]|70)|0(?:10|11|16|17|18|19|2|[3-6][1-5]|70|80))[ \t-]{0,3}[0-9]{3,4}[ \t-]{0,3}[0-9]{4}/g,(v,s,e)=>numericBoundary(text,s,e)&&(!/^(?:010|\+82[ \t-]*10)/.test(v)||digits(v).length===(v[0]==='+'?12:11)),'전화번호 형식을 확인했습니다.');
    const labels='성명|예금주|고객명|계약자|채무자|채권자|신청인|수취인|성[ \t]+명';
    const namePattern=new RegExp('(?:^|[\\s:：;|,()[\\]])(?:'+labels+')[ \\t]*(?:[:：][ \\t]*)?(?<value>[가-힣]{2,5}|[가-힣](?:[ \\t]+[가-힣]){1,4})(?=$|[\\s,;:：()[\\]])','g');
    scan('name',namePattern,v=>!['성명','예금주','고객명','계약자','채무자','채권자','신청인','수취인','확인','서명','필수','없음','미기재','주식회사','법인명','상호명'].includes(v.replace(/\s/g,'')),'이름 라벨 옆의 한글 이름입니다.');
    scan('address',/(?:^|[\s:：;|,()[\]])(?:주소|소재지|거주지|주[ \t]+소)[ \t]*(?:[:：][ \t]*)?(?<value>[^\r\n;|]{6,180})/g,addressValid,'주소 라벨 옆의 주소 형식입니다.');
    // Stop an address at the next labelled field; its label and value are not
    // part of this address, even when Paddle supplied one long OCR line.
    for(const hit of hits){if(hit.type==='address'){
      const stop=hit.text.search(/[ \t]+(?:성명|예금주|고객명|전화|연락처|휴대폰|계좌|주민|생년월일|이메일|email)[ \t]*[:：]/i);
      if(stop>=0){hit.text=hit.text.slice(0,stop).trimEnd();hit.end=hit.start+hit.text.length;}else{hit.text=hit.text.trimEnd();hit.end=hit.start+hit.text.length;}
    }}
    const priority={rrn:0,email:1,account:2,card:3,phone:4,name:5,address:6};
    hits.sort((a,b)=>priority[a.type]-priority[b.type]||a.start-b.start);
    const chosen=[],occupied=new Uint8Array(text.length);
    for(const hit of hits){
      if(hit.type==='address'&&!addressValid(hit.text))continue;
      let overlaps=false;for(let i=hit.start;i<hit.end;i++){if(occupied[i]){overlaps=true;break;}}
      if(!overlaps){chosen.push(hit);occupied.fill(1,hit.start,hit.end);}
    }
    return chosen.sort((a,b)=>a.start-b.start);
  }
  function hiddenRange(hit,style){
    if(style!=='partial')return [0,hit.text.length];
    const text=hit.text,d=digitPositions(text);
    if(hit.type==='rrn')return [d[6],d.at(-1)+1];
    if(hit.type==='phone'){
      const international=text.startsWith('+'),country=international?2:0,national=digits(text).slice(country),prefix=country+(international?(national.startsWith('2')?1:2):(national.startsWith('02')?2:3));
      return [d[prefix],d[d.length-4]];
    }
    if(hit.type==='account')return [0,d[d.length-4]];
    if(hit.type==='card')return [d[4],d[d.length-4]];
    if(hit.type==='email'){const at=text.indexOf('@');return [at>3?2:at>1?1:0,at];}
    if(hit.type==='name'){
      const letters=[];for(let i=0;i<text.length;i++)if(/[가-힣]/.test(text[i]))letters.push(i);
      return letters.length>2?[letters[1],letters.at(-1)]:[letters[1],letters[1]+1];
    }
    if(hit.type==='address'){
      const prefix=text.match(/^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별자치시|특별시|광역시|특별자치도|도)?[ \t]+)?(?:[가-힣]{1,12}(?:시|군|구|읍|면)[ \t]+){1,3}/)?.[0].length||0;
      return [prefix,text.length];
    }
    return [0,text.length];
  }
  // Unkerned Helvetica-compatible advances make the no-canvas fallback useful
  // for common PDFs. This remains an estimate, not a recovered document font.
  const asciiAdvance=[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const weight=char=>asciiAdvance[char.charCodeAt(0)-32]??(/[\u1100-\uffff]/.test(char)?1000:/\s/.test(char)?278:600);
  function proportionalRange(text,start,end,measureText){
    if(typeof measureText==='function'){
      try{
        const width=value=>{const result=measureText(value);return typeof result==='number'?result:result?.width;};
        const total=width(text),left=start?width(text.slice(0,start)):0,right=end===text.length?total:width(text.slice(0,end));
        if(Number.isFinite(total)&&total>0&&Number.isFinite(left)&&Number.isFinite(right)&&left>=0&&right>left&&right<=total)return [left/total,right/total];
      }catch(error){if(error?.code==='PRIVACY_DETECT_LIMIT')throw error; /* A missing font may use the fallback; a work limit must abort. */ }
    }
    let total=0,left=0,right=0;
    for(let i=0;i<text.length;i++){const n=weight(text[i]);total+=n;if(i<start)left+=n;if(i<end)right+=n;}
    return [left/Math.max(total,.01),right/Math.max(total,.01)];
  }
  function suggestion(run,hit,style,measureText){
    const [from,to]=hiddenRange(hit,style),start=hit.start+from,end=hit.start+to,boxes=[],wordIndices=new Set();let approximate=false,corrected=false;
    if(!Number.isInteger(from)||!Number.isInteger(to)||to<=from)fail('가리기 범위를 계산하지 못했습니다. 전체 가리기를 사용해 주세요.');
    // Text offsets are sorted. Find the two nearest preserved tokens once,
    // instead of scanning a dense OCR run again for every candidate rectangle.
    const segments=run.segments;let lo=0,hi=segments.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(segments[mid].end<=start)lo=mid+1;else hi=mid;}
    const firstAffected=lo,neighbors=segments[lo-1]?[segments[lo-1]]:[];lo=0;hi=segments.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(segments[mid].start<end)lo=mid+1;else hi=mid;}
    if(segments[lo])neighbors.push(segments[lo]);
    for(let i=firstAffected;i<segments.length;i++){
      const token=segments[i];
      if(token.start>=end)break;if(token.end<=start)continue;
      let a=Math.max(start,token.start)-token.start,b=Math.min(end,token.end)-token.start;
      if(!token.text.slice(a,b).trim())continue;
      // Separators beside preserved digits need not be hidden. Leave their
      // spacing available for a small ink margin without covering the next digit.
      if(style==='partial'){while(a<b&&/[\s-]/.test(token.text[a]))a++;while(b>a&&/[\s-]/.test(token.text[b-1]))b--;}
      if(a===b)continue;
      const full=a===0&&b===token.text.length,range=full?[0,1]:proportionalRange(token.text,a,b,measureText),[l,t,r,bt]=token.box;
      let box=[l+(r-l)*range[0],t,l+(r-l)*range[1],bt];
      // Paddle reports a line quadrilateral. Slice along its baseline before
      // making the axis-aligned mask, rather than slicing the enclosing box.
      if(token.quad){
        const q=token.quad,mix=(u,v,f)=>[u[0]+(v[0]-u[0])*f,u[1]+(v[1]-u[1])*f],points=[mix(q[0],q[1],range[0]),mix(q[0],q[1],range[1]),mix(q[3],q[2],range[0]),mix(q[3],q[2],range[1])];
        box=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
      }
      const glyph=(r-l)/Math.max(1,[...token.text].length),padX=Math.min(.002,glyph*.12),padY=Math.min(.0015,(bt-t)*.08);
      // Word boundaries may under-report anti-aliased tails. Internal boundaries
      // only grow into a space/hyphen, never into a preserved letter or digit.
      const gapAt=index=>{if(index<0||index>=token.text.length)return Infinity;if(!/[\s-]/.test(token.text[index]))return 0;const part=proportionalRange(token.text,index,index+1,measureText);return (r-l)*(part[1]-part[0])*.45;};
      let left=Math.min(padX,gapAt(a-1)),right=Math.min(padX,gapAt(b));
      for(const neighbor of neighbors){
        if(neighbor===token)continue;
        const n=neighbor.box;if(Math.min(n[3],box[3])<=Math.max(n[1],box[1]))continue;
        if(neighbor.end<=start)left=Math.min(left,Math.max(0,(box[0]-n[2])*.45));
        if(neighbor.start>=end)right=Math.min(right,Math.max(0,(n[0]-box[2])*.45));
      }
      boxes.push([Math.max(0,box[0]-left),Math.max(0,box[1]-padY),Math.min(1,box[2]+right),Math.min(1,box[3]+padY)]);for(const index of token.indices)wordIndices.add(index);
      approximate||=!full||token.corrected;corrected||=token.corrected;
    }
    if(!boxes.length||boxes.some(box=>!validBox(box)))fail('가리기 위치를 계산하지 못했습니다. 인식 결과를 다시 확인해 주세요.');
    const maskedText=hit.text.slice(0,from)+hit.text.slice(from,to).replace(/[^\s-]/g,'*')+hit.text.slice(to);
    const reason=hit.reason+(corrected?' 교정한 글줄의 위치를 추정했습니다.':approximate?' 글자 일부의 위치를 추정했습니다.':'');
    return {type:hit.type,text:hit.text,maskedText,boxes,wordIndices:[...wordIndices],approximate,reason};
  }
  function detect(record,settings,measureText){
    const selected=normalizeSettings(settings),enabled=new Set(selected.types),tokens=tokensFor(record),result=[];
    if(!enabled.size)return result;
    let measuredChars=0;
    const boundedMeasure=typeof measureText==='function'?text=>{
      measuredChars+=text.length;
      if(measuredChars>MAX_MEASURE_CHARS)fail('한 인식 영역에 글자가 너무 많이 합쳐졌습니다. 영역을 나눠 다시 인식한 뒤 개인정보를 확인해 주세요.','PRIVACY_DETECT_LIMIT');
      return measureText(text);
    }:undefined;
    for(const run of contextRunsFor(runsFor(tokens),enabled)){
      for(const hit of hitsFor(run.text)){if(!enabled.has(hit.type))continue;
        const candidate=suggestion(run,hit,selected.style,boundedMeasure);
        if(run.contextLinked)candidate.reason+=' 같은 행의 라벨과 값을 연결했습니다.';
        result.push(candidate);
        if(result.length>MAX_CANDIDATES)fail('한 페이지의 개인정보 후보가 2,000개를 넘습니다. 인식 범위를 나누어 확인해 주세요.','PRIVACY_DETECT_LIMIT');
      }
    }
    return result;
  }
  const api=Object.freeze({TYPES,PRESETS,normalizeSettings,detect});root.PDFPrivacyDetect=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
