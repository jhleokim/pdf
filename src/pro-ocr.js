/* Offline OCR and invisible Unicode text; no document data leaves this page. */
(() => {
  'use strict';
  const check=signal=>{if(signal?.aborted)throw new DOMException('취소했습니다.','AbortError');};
  function bytes(id){return Uint8Array.from(atob(document.getElementById(id).textContent.trim()),c=>c.charCodeAt(0));}
  function bounded(promise,signal,ms=120000){
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      const abort=()=>{cleanup();reject(new DOMException('취소했습니다.','AbortError'));};
      const timer=setTimeout(()=>{cleanup();reject(new Error('인식 시간이 초과됐습니다. 페이지를 나누어 다시 시도하세요.'));},ms);
      signal?.addEventListener('abort',abort,{once:true});
      promise.then(value=>{cleanup();resolve(value);},e=>{cleanup();reject(e);});
      if(signal?.aborted)abort();
    });
  }
  async function session(language,signal,onProgress,layout='auto'){
    check(signal);
    if(!globalThis.Tesseract){
      const script=document.createElement('script');script.textContent=new TextDecoder().decode(bytes('ocr-client'));document.head.appendChild(script);
    }
    // 5.1.1 accepts {code,data} while loading but reads .data as a language name
    // during initialize. Normalize only that message in our worker bootstrap.
    const bootstrap=`self.addEventListener('message',e=>{const m=e.data;if(m.action==='initialize'&&Array.isArray(m.payload?.langs))m.payload.langs=m.payload.langs.map(l=>typeof l==='string'?l:l.code);});\n`;
    const url=URL.createObjectURL(new Blob([bootstrap,bytes('ocr-core'),'\n',bytes('ocr-worker')],{type:'application/javascript'}));
    const languages=(language==='eng'?['eng']:['kor','eng']).map(code=>({code,data:bytes('ocr-lang-'+code)}));
    let worker,closed=false,rejectFault;
    const fault=new Promise((_,reject)=>{rejectFault=reject;});fault.catch(()=>{});
    const pending=Tesseract.createWorker(languages,1,{workerPath:url,workerBlobURL:false,corePath:'embedded.js',cacheMethod:'none',logger:m=>onProgress?.(m),errorHandler:e=>rejectFault(new Error('인식 엔진: '+String(e)))});
    pending.then(w=>{if(closed)w.terminate().catch(()=>{});},()=>{});
    const close=async()=>{closed=true;signal?.removeEventListener('abort',close);if(worker)await worker.terminate().catch(()=>{});URL.revokeObjectURL(url);};
    signal?.addEventListener('abort',close,{once:true});
    try{worker=await bounded(Promise.race([pending,fault]),signal);check(signal);await bounded(worker.setParameters({tessedit_pageseg_mode:'3',preserve_interword_spaces:'1',user_defined_dpi:'300'}),signal);}
    catch(e){await close();throw e;}
    return {close,async recognize(canvas){
      async function pass(psm){
      check(signal);await bounded(worker.setParameters({tessedit_pageseg_mode:psm}),signal);
      const {data}=await bounded(worker.recognize(canvas,{}, {text:true,blocks:true}),signal);check(signal);
      const rawWords=(data.words||data.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words)))||[])
        .filter(w=>w.text?.trim()&&w.bbox&&w.bbox.x1>w.bbox.x0&&w.bbox.y1>w.bbox.y0)
        .map(w=>({text:w.text.trim(),confidence:w.confidence||0,box:[w.bbox.x0/canvas.width,w.bbox.y0/canvas.height,w.bbox.x1/canvas.width,w.bbox.y1/canvas.height]}));
      // Tesseract can split Korean syllables into separate word objects. Join
      // contiguous syllables using the engine's actual text, not inserted spaces.
      const words=[];let cursor=0;
      for(let i=0;i<rawWords.length;i++){
        const word=rawWords[i],at=data.text.indexOf(word.text,cursor),end=at<0?cursor:at+word.text.length;
        const next=rawWords[i+1],nextAt=next?data.text.indexOf(next.text,end):-1;
        word.separator=nextAt>=0?data.text.slice(end,nextAt):'\n';cursor=end;
        const previous=words[words.length-1];
        if(previous&&previous.separator===''&&Math.abs(previous.box[1]-word.box[1])<.02){
          const n=[...previous.text].length,m=[...word.text].length;previous.confidence=(previous.confidence*n+word.confidence*m)/(n+m);previous.text+=word.text;previous.box=[Math.min(previous.box[0],word.box[0]),Math.min(previous.box[1],word.box[1]),Math.max(previous.box[2],word.box[2]),Math.max(previous.box[3],word.box[3])];previous.separator=word.separator;
        }else words.push(word);
      }
      return {text:data.text.trim(),confidence:data.confidence||0,words,psm};
      }
      const first=await pass(layout==='auto'?'3':layout);
      if(layout!=='auto')return first;
      onProgress?.({status:'checking missed lines',progress:0});
      const alternate=await pass('6');
      const score=r=>r.words.reduce((sum,w)=>sum+(w.confidence>=40?[...w.text].length*w.confidence/100:0),0);
      return score(alternate)>score(first)*1.03?alternate:first;
    }};
  }
  function makeFont(doc,records){
    const P=PDFLib,c=doc.context,chars=[...new Set(records.flatMap(r=>r.words.flatMap(w=>[...w.text,' '])))];
    if(chars.length>60000)throw new Error('인식한 문자 종류가 너무 많습니다. 문서를 나누어 처리하세요.');
    const map=new Map(chars.map((ch,i)=>[ch,i+1]));
    const hex=n=>n.toString(16).padStart(4,'0').toUpperCase();
    const unicode=ch=>Array.from({length:ch.length},(_,i)=>hex(ch.charCodeAt(i))).join('');
    let cmap='/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /PDFStudioOCR def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for(let i=0;i<chars.length;i+=100){const part=chars.slice(i,i+100);cmap+=`${part.length} beginbfchar\n`+part.map(ch=>`<${hex(map.get(ch))}> <${unicode(ch)}>`).join('\n')+'\nendbfchar\n';}
    cmap+='endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    const descriptor=c.register(c.obj({Type:'FontDescriptor',FontName:'PDFStudioOCR',Flags:4,FontBBox:[0,-200,1000,1000],ItalicAngle:0,Ascent:800,Descent:-200,CapHeight:800,StemV:80}));
    const descendant=c.register(c.obj({Type:'Font',Subtype:'CIDFontType2',BaseFont:'PDFStudioOCR',CIDSystemInfo:{Registry:P.PDFString.of('Adobe'),Ordering:P.PDFString.of('Identity'),Supplement:0},FontDescriptor:descriptor,DW:600,CIDToGIDMap:'Identity'}));
    const ref=c.register(c.obj({Type:'Font',Subtype:'Type0',BaseFont:'PDFStudioOCR',Encoding:'Identity-H',DescendantFonts:[descendant],ToUnicode:c.register(c.flateStream(cmap))}));
    return {ref,encode:text=>P.PDFHexString.of([...text].map(ch=>hex(map.get(ch))).join(''))};
  }
  async function apply(doc,records,{pageIds=[],signal}={}){
    const active=(records||[]).filter(r=>pageIds.includes(r.uid)&&r.words.length);
    if(!active.length)return {pages:0,words:0};
    const P=PDFLib,G=PDFProDocument,font=makeFont(doc,active);let pages=0,words=0;
    for(const record of active){
      check(signal);const page=doc.getPage(pageIds.indexOf(record.uid)),b=G.visibleBox(page),r=((page.getRotation().angle%360)+360)%360;
      const w=r%180?b.height:b.width,h=r%180?b.width:b.height,rad=r*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
      const name=page.node.newFontDictionary('OCR',font.ref),ops=[P.pushGraphicsState(),P.beginText(),P.setTextRenderingMode(3),P.setFontAndSize(name,1)];
      for(const word of record.words){
        const [l,t,rt,bt]=word.box;if(![l,t,rt,bt].every(Number.isFinite)||rt<=l||bt<=t)continue;
        const text=word.text+(word.separator===''?'':' '),sx=(rt-l)*w/(Math.max(1,[...word.text].length)*.6),sy=(bt-t)*h;
        const [x,y]=G.displayToPdf(l*w,(bt-(bt-t)*.18)*h,b,r);
        ops.push(P.setTextMatrix(sx*cos,sx*sin,-sy*sin,sy*cos,x,y),P.showText(font.encode(text)));words++;
      }
      ops.push(P.endText(),P.popGraphicsState());page.pushOperators(...ops);pages++;
    }
    return {pages,words};
  }
  globalThis.PDFOCR={session,apply};
})();
