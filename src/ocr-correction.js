/* Local OCR correction: edit a draft, then atomically hand it back to Studio. */
(() => {
  'use strict';
  const copy=value=>typeof structuredClone==='function'?structuredClone(value):clonePlain(value);
  function clonePlain(value){if(Array.isArray(value))return value.map(clonePlain);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clonePlain(item)]));return value;}
  const singleLine=value=>String(value??'').replace(/[\r\n\u2028\u2029]+/g,' ');
  function createDraft(records){if(!Array.isArray(records))throw new TypeError('교정할 인식 결과가 필요합니다.');return {original:copy(records),records:copy(records)};}
  function updateWord(draft,page,index,text){const word=draft.records[page]?.words?.[index];if(!word||draft.records[page].skipped)throw new RangeError('수정할 텍스트 영역이 없습니다.');word.text=singleLine(text);return word.text;}
  function changedWords(draft){let count=0;draft.records.forEach((record,p)=>{if(record.skipped)return;if(record.words?.length)record.words.forEach((word,w)=>{if(word.text!==draft.original[p].words[w].text)count++;});else if(record.text!==draft.original[p].text)count++;});return count;}
  function materialize(draft){return draft.records.map((record,p)=>{const out=copy(record);if(out.skipped)return out;if(out.words?.length){let changed=false;out.words.forEach((word,w)=>{if(word.text!==draft.original[p].words[w].text){changed=true;word.corrected=true;word.uncertain=false;}});if(changed)out.text=out.words.filter(word=>word.text?.trim()).map(word=>word.text+(word.separator??' ')).join('').trim();}return out;});}
  function boxOf(word){const b=Array.isArray(word?.box)?word.box:[word?.x,word?.y,word?.x+word?.w,word?.y+word?.h];return b.length===4&&b.every(Number.isFinite)&&b[0]>=0&&b[1]>=0&&b[2]<=1&&b[3]<=1&&b[2]>b[0]&&b[3]>b[1]?b:null;}
  const data=Object.freeze({createDraft,updateWord,changedWords,materialize,boxOf,singleLine});
  let active=null;
  function open(options={}){
    if(active)return Promise.reject(new Error('텍스트 교정 창이 이미 열려 있습니다.'));
    const dialog=document.getElementById('ocrCorrectionDialog');
    if(!dialog||typeof dialog.showModal!=='function')return Promise.reject(new Error('텍스트 교정 창을 준비하지 못했습니다. 페이지를 다시 열어 주세요.'));
    if(!options.records?.length||typeof options.renderPage!=='function')return Promise.reject(new Error('교정할 페이지와 미리보기가 필요합니다.'));
    const $=name=>document.getElementById('ocrCorrection'+name),draft=createDraft(options.records);
    const listeners=new AbortController(),savedFocus=document.activeElement;
    let page=Math.max(0,Math.min(draft.records.length-1,Number(options.initialIndex)||0)),zoom=1,selected=-1,closed=false,applying=false,renderSequence=0,renderAbort=null;
    let rendered=false;
    const selectedByPage=new Map(),fieldNodes=new Map(),boxNodes=new Map();
    const promise=new Promise(resolve=>{active={resolve};});
    const session=active;
    const on=(node,type,handler)=>node.addEventListener(type,handler,{signal:listeners.signal});
    const motion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
    function scrollNear(container,node){if(!node)return;const c=container.getBoundingClientRect(),n=node.getBoundingClientRect();let top=container.scrollTop,left=container.scrollLeft;if(n.top<c.top+12)top-=c.top+12-n.top;else if(n.bottom>c.bottom-12)top+=n.bottom-c.bottom+12;if(n.left<c.left+12)left-=c.left+12-n.left;else if(n.right>c.right-12)left+=n.right-c.right+12;container.scrollTo({top,left,behavior:motion()});}
    function grow(input){input.style.height='auto';input.style.height=Math.min(220,Math.max(29,input.scrollHeight+2))+'px';}
    function refreshChanges(){const count=changedWords(draft);$('Changes').textContent=count?`${count}개 영역 수정 · 적용 전`:'수정한 영역 없음';$('Apply').disabled=!count||applying;}
    function showError(message){$('Error').textContent=message||'';$('Error').hidden=!message;}
    function focusWord(index,fromBox=false){
      if(!fieldNodes.has(index))return;
      selected=index;selectedByPage.set(page,index);
      for(const [i,node] of fieldNodes)node.row.classList.toggle('is-active',i===index);
      for(const [i,node] of boxNodes){node.setAttribute('aria-pressed',String(i===index));node.tabIndex=i===index?0:-1;}
      $('Selection').textContent=index<0?'페이지 텍스트 선택':`${index+1}번 영역 선택`;
      const field=fieldNodes.get(index);
      if(fromBox){field.input.focus({preventScroll:true});field.input.select();scrollNear($('Fields'),field.row);}else scrollNear($('ImageScroll'),boxNodes.get(index));
    }
    function renderField(word,index,plain=false){
      const row=document.createElement('div');row.className='ocr-correction-field'+(plain?' is-plain':'');row.dataset.word=String(index);
      const top=document.createElement('div');top.className='ocr-correction-field-top';
      const label=document.createElement('label');label.htmlFor='ocrCorrectionWord'+index;label.textContent=plain?'페이지 텍스트':String(index+1).padStart(2,'0');
      const status=document.createElement('span');status.className='ocr-correction-field-status';
      const low=document.createElement('span');low.className='needs-review';low.textContent='확인 필요';low.hidden=!word.uncertain&&!(Number.isFinite(word.confidence)&&word.confidence<70);
      const edited=document.createElement('span');edited.className='was-edited';edited.textContent='수정됨';edited.hidden=true;
      status.append(low,edited);top.append(label,status);
      const input=document.createElement('textarea');input.id=label.htmlFor;input.rows=1;input.spellcheck=false;input.value=word.text||'';input.setAttribute('aria-label',plain?'페이지 인식 텍스트':`${index+1}번 영역 인식 텍스트`);input.placeholder='빈 영역 · 검색 텍스트에서 제외';input.dataset.word=String(index);
      row.append(top,input);$('Fields').append(row);fieldNodes.set(index,{row,input,edited,low});grow(input);
      edited.hidden=plain?draft.records[page].text===draft.original[page].text:word.text===draft.original[page].words[index].text;
      if(!plain){const b=boxOf(word);if(b){const box=document.createElement('button');box.type='button';box.className='ocr-correction-box';box.dataset.word=String(index);box.dataset.empty=String(!word.text?.trim());box.setAttribute('aria-label',`${index+1}번 영역: ${word.text?.slice(0,90)||'빈 텍스트'}`);box.setAttribute('aria-controls',input.id);box.setAttribute('aria-pressed','false');box.tabIndex=-1;box.style.left=b[0]*100+'%';box.style.top=b[1]*100+'%';box.style.width=(b[2]-b[0])*100+'%';box.style.height=(b[3]-b[1])*100+'%';$('Boxes').append(box);boxNodes.set(index,box);}}
    }
    function fitWidth(){const pane=$('ImageScroll');return Math.max(100,pane.clientWidth-(innerWidth<=760?32:48)-2);}
    function updateZoom(){$('Sheet').style.width=fitWidth()*zoom+'px';$('ZoomValue').value=Math.round(zoom*100)+'%';$('ZoomOut').disabled=zoom<=.5;$('ZoomIn').disabled=zoom>=3;}
    async function renderPage(){
      const id=++renderSequence;renderAbort?.abort();renderAbort=new AbortController();const signal=renderAbort.signal;
      rendered=false;$('Sheet').hidden=true;$('ImageState').hidden=false;$('ImageState').textContent='페이지를 준비하고 있습니다.';
      const canvas=$('Canvas');canvas.width=canvas.height=1;$('ImageScroll').scrollTo({top:0,left:0,behavior:'instant'});$('Fields').scrollTop=0;
      fieldNodes.clear();boxNodes.clear();$('Fields').replaceChildren();$('Boxes').replaceChildren();$('Selection').textContent='영역을 선택하세요';
      const record=draft.records[page];$('Page').value=String(page);$('PageCount').textContent=`${page+1} / ${draft.records.length}`;$('Prev').disabled=page===0;$('Next').disabled=page===draft.records.length-1;
      $('FieldCount').textContent=record.words?.length?`${record.words.length}개 영역`:'';
      if(record.skipped){const note=document.createElement('p');note.className='ocr-correction-empty';note.textContent='기존 검색 텍스트를 유지한 페이지입니다. 새 인식 결과가 없어 교정할 영역이 없습니다.';$('Fields').append(note);}
      else if(record.words?.length)record.words.forEach((word,index)=>renderField(word,index));
      else{renderField({text:record.text||''},-1,true);const note=document.createElement('p');note.className='ocr-correction-empty';note.textContent='영역 위치가 없는 결과입니다. 텍스트 파일용 내용을 수정할 수 있습니다.';$('Fields').prepend(note);}
      selected=selectedByPage.get(page)??(record.words?.length?0:-1);if(fieldNodes.has(selected))focusWord(selected);
      try{
        const source=await options.renderPage(copy(record),{signal});
        if(closed||id!==renderSequence||signal.aborted)return;
        if(!source?.width||!source?.height)throw new Error('페이지 이미지를 불러오지 못했습니다.');
        canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d',{alpha:false}).drawImage(source,0,0);rendered=true;$('Sheet').hidden=false;$('ImageState').hidden=true;updateZoom();
      }catch(error){if(closed||id!==renderSequence||signal.aborted)return;$('ImageState').textContent=error?.message||'페이지를 불러오지 못했습니다. 다른 페이지를 선택한 뒤 다시 확인해 주세요.';}
      refreshChanges();
    }
    function finish(applied){if(closed)return;closed=true;renderAbort?.abort();listeners.abort();observer?.disconnect();$('Canvas').width=$('Canvas').height=1;fieldNodes.clear();boxNodes.clear();$('Fields').replaceChildren();$('Boxes').replaceChildren();if(dialog.open)dialog.close();dialog.removeAttribute('data-applying');active=null;session.resolve(applied);if(savedFocus?.isConnected)savedFocus.focus({preventScroll:true});}
    function requestClose(){if(applying)return;if(changedWords(draft)){showError('');$('Actions').hidden=true;$('Discard').hidden=false;$('Keep').focus();}else finish(false);}
    function changePage(index){if(applying)return;page=Math.max(0,Math.min(draft.records.length-1,index));showError('');renderPage();}
    on($('Fields'),'focusin',event=>{if(event.target.matches('textarea[data-word]'))focusWord(Number(event.target.dataset.word));});
    on($('Fields'),'input',event=>{
      const input=event.target;if(applying||!input.matches('textarea[data-word]'))return;const index=Number(input.dataset.word),field=fieldNodes.get(index);
      if(index<0)draft.records[page].text=input.value;
      else{const normalized=updateWord(draft,page,index,input.value);if(input.value!==normalized){const start=input.selectionStart,end=input.selectionEnd;input.value=normalized;input.setSelectionRange(Math.min(start,normalized.length),Math.min(end,normalized.length));}const box=boxNodes.get(index);if(box){box.dataset.empty=String(!normalized.trim());box.setAttribute('aria-label',`${index+1}번 영역: ${normalized.slice(0,90)||'빈 텍스트'}`);}}
      field.edited.hidden=index<0?draft.records[page].text===draft.original[page].text:draft.records[page].words[index].text===draft.original[page].words[index].text;
      grow(input);refreshChanges();showError('');
    });
    on($('Boxes'),'click',event=>{const box=event.target.closest('button[data-word]');if(box)focusWord(Number(box.dataset.word),true);});
    on($('Boxes'),'keydown',event=>{const box=event.target.closest('button[data-word]');if(!box||!['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(event.key))return;event.preventDefault();const keys=[...boxNodes.keys()],at=keys.indexOf(Number(box.dataset.word)),next=keys[Math.max(0,Math.min(keys.length-1,at+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)))];focusWord(next);boxNodes.get(next)?.focus({preventScroll:true});scrollNear($('ImageScroll'),boxNodes.get(next));scrollNear($('Fields'),fieldNodes.get(next)?.row);});
    on($('Page'),'change',()=>changePage(Number($('Page').value)));on($('Prev'),'click',()=>changePage(page-1));on($('Next'),'click',()=>changePage(page+1));
    on($('ZoomOut'),'click',()=>{zoom=Math.max(.5,Math.round((zoom-.25)*100)/100);updateZoom();});on($('ZoomIn'),'click',()=>{zoom=Math.min(3,Math.round((zoom+.25)*100)/100);updateZoom();});on($('Fit'),'click',()=>{zoom=1;updateZoom();});
    on($('Close'),'click',requestClose);on($('Cancel'),'click',requestClose);on(dialog,'cancel',event=>{event.preventDefault();requestClose();});
    on(dialog,'close',()=>finish(false));
    on($('Keep'),'click',()=>{$('Discard').hidden=true;$('Actions').hidden=false;fieldNodes.get(selected)?.input.focus({preventScroll:true});});on($('DiscardConfirm'),'click',()=>finish(false));
    on($('Apply'),'click',async()=>{if(applying||!changedWords(draft))return;applying=true;dialog.dataset.applying='true';const controls=[...dialog.querySelectorAll('button,select,textarea')].map(node=>[node,node.disabled]);for(const [node] of controls)node.disabled=true;$('Apply').textContent='적용 중…';showError('');try{await options.onApply?.(materialize(draft));for(const [node,disabled] of controls)node.disabled=disabled;finish(true);}catch(error){applying=false;dialog.removeAttribute('data-applying');for(const [node,disabled] of controls)node.disabled=disabled;$('Apply').textContent='수정 적용';showError(error?.message||'수정 내용을 적용하지 못했습니다. 다시 시도해 주세요.');refreshChanges();}});
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{if(rendered)updateZoom();}):null;
    observer?.observe($('ImageScroll'));
    $('Page').replaceChildren();draft.records.forEach((record,index)=>{const option=document.createElement('option');option.value=index;option.textContent=`${record.page??index+1}쪽${record.skipped?' · 기존 텍스트':''}`;$('Page').append(option);});
    $('Apply').textContent='수정 적용';$('Close').disabled=$('Cancel').disabled=false;$('Actions').hidden=false;$('Discard').hidden=true;showError('');refreshChanges();
    try{dialog.showModal();$('Page').focus();renderPage();}catch(error){finish(false);return Promise.reject(error);}
    return promise;
  }
  globalThis.PDFOCRCorrection=Object.freeze({open,data});
})();
