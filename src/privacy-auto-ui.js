/* Candidates are a disposable draft. Only reviewed rectangles enter the document. */
(function(){
  'use strict';
  const el=id=>$('privacyAuto'+id),dialog=el('Dialog'),NS='http://www.w3.org/2000/svg',storageKey='pdfstudio-privacy-presets-v1';
  let entries=[],pageIndex=0,active=null,shown=50,ready=false,working=false,sequence=0,controller=null,gesture=null,presets=[];
  const confirmed=new Set();
  const notices=new Map();
  const settings=()=>PDFPrivacyDetect.normalizeSettings({types:[...el('Types').querySelectorAll('input:checked')].map(n=>n.value),style:el('Style').value});
  const entry=()=>entries[pageIndex],chosen=()=>entries.flatMap(e=>e.candidates.filter(c=>c.selected));
  const status=(id,message,error=false)=>{el(id).textContent=message;el(id).dataset.error=String(error);};
  const notice=(id,message,error=false)=>{notices.set(id,[message,error]);status(id,message,error);};
  const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
  function geometrySafe(o,list){return !o.deskew&&!o.crop&&(!o.paper||o.paper==='original')&&list.every(p=>!o.deskewAngles?.[p.uid]&&!o.deskewCropByPage?.[p.uid]);}
  function assess(){
    const list=toolTargets(el('Scope').value),o=readProOptions(false,[]),records=new Map(ocrRecords.map(r=>[r.uid,r]));
    if(!list.length)return {list,o,error:'탐지할 페이지를 선택하세요.'};
    if(!geometrySafe(o,list))return {list,o,error:'기울기·재단·페이지 규격 변경을 끄고 페이지 전체를 다시 인식하세요.'};
    const missing=list.filter(p=>{
      const r=records.get(p.uid);
      if(!r||r.skipped||r.coverage!=='full'||!Array.isArray(r.words)||!ocrRecordCurrent(r,p,o))return true;
      if(!r.words.length)return typeof r.text!=='string'||!!r.text.trim();
      return !r.words.some(w=>w?.text?.trim())||!r.words.every(w=>typeof w?.text==='string'&&(!w.text.trim()||ocrValidWord(w)));
    });
    return {list,o,records,missing,error:missing.length?list.length+'페이지 중 '+missing.length+'페이지에 전체 OCR이 필요합니다.':''};
  }
  function syncSetup(){
    if(!dialog.open||!el('Review').hidden)return;
    const state=assess();status('SetupStatus',...(notices.get('SetupStatus')||[state.error||state.list.length+'페이지 인식 완료 · 탐지할 종류를 선택하세요.']));
    el('Find').disabled=working||ocrRunning||!!proAbort||!!state.error||!settings().types.length;
    el('OCR').disabled=working||ocrRunning||!!proAbort||!state.list.length;el('OCR').hidden=!state.error;
    lockControls();
  }
  function lockControls(){
    for(const id of ['Scope','Preset','Style','PresetName','PresetSave','More'])el(id).disabled=working;
    el('PresetDelete').disabled=working||!presets.some(p=>p.id===el('Preset').value);
    for(const input of el('Types').querySelectorAll('input'))input.disabled=working;
    for(const input of el('Candidates').querySelectorAll('input,button'))input.disabled=working;
  }
  function sync(){
    const selected=chosen(),needed=entries.filter(e=>e.candidates.some(c=>c.selected));
    el('Apply').disabled=working||!ready||!!gesture||!selected.length||needed.some(e=>!confirmed.has(e.uid));
    el('PageConfirm').checked=!!entry()&&confirmed.has(entry().uid);
    el('PageConfirm').disabled=working||!ready||!!gesture||!entry()?.candidates.some(c=>c.selected);
    el('Prev').disabled=working||pageIndex===0;el('Next').disabled=working||pageIndex>=entries.length-1;
    for(const id of ['Page','SelectPage','ClearSelection','EditSettings'])el(id).disabled=working;
    dialog.dataset.busy=String(working);
    lockControls();
    if(!working&&!el('Review').hidden)status('Status',...(notices.get('Status')||[selected.length+'개 선택 · '+needed.filter(e=>confirmed.has(e.uid)).length+'/'+needed.length+'페이지 확인']));
  }
  function loadPresets(){try{presets=PDFPrivacyAutoModel.readPresets(localStorage.getItem(storageKey));}catch{presets=[];}}
  function presetOptions(value='numbers'){
    el('Preset').replaceChildren();
    for(const p of [...PDFPrivacyDetect.PRESETS,...presets,{id:'custom',name:'직접 선택'}]){const opt=new Option(p.name,p.id);el('Preset').append(opt);}
    el('Preset').value=value;el('PresetDelete').disabled=!presets.some(p=>p.id===value);
  }
  function setSettings(value){const s=PDFPrivacyDetect.normalizeSettings(value);for(const input of el('Types').querySelectorAll('input'))input.checked=s.types.includes(input.value);el('Style').value=s.style;updateTypeLabels();syncSetup();}
  function updateTypeLabels(){for(const type of PDFPrivacyDetect.TYPES){const span=el('Types').querySelector('[data-type="'+type.id+'"]');span.textContent=type.label+(el('Style').value==='partial'?' · '+type.partialLabel:'');}}
  for(const type of PDFPrivacyDetect.TYPES){const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='checkbox';input.value=type.id;span.dataset.type=type.id;label.append(input,span);el('Types').append(label);}
  el('Preset').onchange=()=>{if(working)return;notices.clear();const value=el('Preset').value,p=[...PDFPrivacyDetect.PRESETS,...presets].find(p=>p.id===value);el('PresetDelete').disabled=!presets.some(p=>p.id===value);if(p){el('PresetName').value=presets.includes(p)?p.name:'';setSettings(p);}};
  for(const id of ['Types','Style'])el(id).onchange=()=>{if(working)return;notices.clear();el('Preset').value='custom';el('PresetDelete').disabled=true;updateTypeLabels();syncSetup();};
  el('Scope').onchange=()=>{if(working)return;notices.clear();syncSetup();};
  el('PresetSave').onclick=()=>{if(working)return;try{const next=PDFPrivacyAutoModel.savePreset(presets,el('PresetName').value,settings());localStorage.setItem(storageKey,JSON.stringify(next));presets=next;presetOptions(next.find(p=>p.name===el('PresetName').value.trim())?.id||'custom');notice('SetupStatus','선택한 종류와 가리는 방식만 저장했습니다.');}catch(e){notice('SetupStatus',e.message||'프리셋을 저장하지 못했습니다.',true);}};
  el('PresetDelete').onclick=()=>{if(working)return;try{const next=PDFPrivacyAutoModel.removePreset(presets,el('Preset').value);localStorage.setItem(storageKey,JSON.stringify(next));presets=next;presetOptions('custom');notice('SetupStatus','프리셋을 삭제했습니다.');}catch{notice('SetupStatus','프리셋을 삭제하지 못했습니다.',true);}};
  async function digestText(text){const bytes=new TextEncoder().encode(text);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
  const digest=record=>digestText(JSON.stringify(record));
  function clearCanvas(){const canvas=el('Canvas');canvas.width=canvas.height=0;el('Overlay').replaceChildren();ready=false;}
  function cancelWork(){sequence++;controller?.abort();controller=null;gesture=null;working=false;clearCanvas();dialog.dataset.dragging='false';}
  function resetDraft(){cancelWork();notices.clear();entries=[];confirmed.clear();active=null;pageIndex=0;el('Candidates').replaceChildren();el('Page').replaceChildren();el('Review').hidden=true;el('Setup').hidden=false;status('Status','');sync();syncSetup();}
  function close(){if(dialog.open)dialog.close();}
  dialog.addEventListener('close',()=>{resetDraft();$('privacyAutoOpen').focus();});
  for(const id of ['Close','Cancel'])el(id).onclick=close;
  el('EditSettings').onclick=()=>{if(!working)resetDraft();};
  globalThis.syncPrivacyAuto=()=>{const open=$('privacyAutoOpen');if(open)open.disabled=!pages.length||!!proAbort||ocrRunning;syncSetup();};
  $('privacyAutoOpen').onclick=()=>{
    if($('privacyAutoOpen').disabled)return;resetDraft();loadPresets();presetOptions();setSettings(PDFPrivacyDetect.PRESETS[0]);dialog.showModal();syncSetup();
  };
  el('OCR').onclick=()=>{
    if(working||el('OCR').disabled)return;
    const scope=el('Scope').value;close();$('ocrScope').value=scope;$('ocrWholePage').checked=true;$('ocrSection').open=true;
    if(typeof setProView==='function')setProView('settings');$('ocrSection').scrollIntoView({block:'nearest',behavior:'smooth'});$('ocrRun').focus();
  };
  el('Find').onclick=async()=>{
    if(working||el('Find').disabled)return;const state=assess();if(state.error){syncSetup();return;}
    notices.clear();cancelWork();const token=sequence,abort=controller=new AbortController();working=true;syncSetup();sync();
    try{
      await PDFPrivacy.assertSupportedSources(state.list,docs);abort.signal.throwIfAborted();
      const next=[],s=settings(),measureCanvas=document.createElement('canvas'),measureContext=measureCanvas.getContext('2d'),measured=new Map();let count=0;
      if(measureContext)measureContext.font='16px Arial, sans-serif';
      const measureText=typeof measureContext?.measureText==='function'?text=>{if(measured.has(text))return measured.get(text);const width=measureContext.measureText(text).width;if(measured.size<512)measured.set(text,width);return width;}:undefined;
      for(let index=0;index<state.list.length;index++){
        abort.signal.throwIfAborted();const p=state.list[index],record=state.records.get(p.uid);
        if(!ocrRecordCurrent(record,p,readProOptions(false,[]))||!pages.includes(p)||!ocrRecords.includes(record))throw Error('문서나 OCR 결과가 바뀌었습니다. 다시 시작하세요.');
        const hash=await digest(record);abort.signal.throwIfAborted();
        const candidates=PDFPrivacyDetect.detect(record,s,measureText).map((c,i)=>({...c,id:p.uid+':'+i,selected:true,boxes:c.boxes.map(b=>[...b])}));
        count+=candidates.length;if(count>10000)throw Error('탐지 후보가 10,000개를 넘습니다. 선택 페이지로 범위를 나누어 주세요.');
        if(candidates.length)next.push({uid:p.uid,page:p,record,hash,candidates});
        status('Status',Math.round((index+1)/state.list.length*100)+'% · '+(index+1)+'/'+state.list.length+'페이지 탐지');await yieldUI();
      }
      abort.signal.throwIfAborted();entries=next;working=false;
      if(!next.length){notice('SetupStatus','선택한 종류의 후보가 없습니다. 탐지에서 놓친 정보는 직접 가릴 수 있습니다.');status('Status','');syncSetup();return;}
      el('Setup').hidden=true;el('Review').hidden=false;el('Page').replaceChildren();
      for(let i=0;i<entries.length;i++)el('Page').append(new Option((pages.indexOf(entries[i].page)+1)+'쪽 · '+entries[i].candidates.length+'개',String(i)));
      await showPage(0);if(dialog.open&&ready)el('Page').focus();
    }catch(e){if(token===sequence&&e.name!=='AbortError'){notice('SetupStatus',e.message||'탐지를 완료하지 못했습니다.',true);status('Status','');}}
    finally{if(token===sequence){working=false;sync();syncSetup();}}
  };
  function svgNode(tag,attributes){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attributes))n.setAttribute(k,v);return n;}
  function renderOverlay(){
    const svg=el('Overlay');svg.replaceChildren();if(!ready||!entry())return;
    for(const c of entry().candidates)for(let i=0;i<c.boxes.length;i++){
      const b=c.boxes[i],rect=svgNode('rect',{x:b[0]*1000,y:b[1]*1000,width:(b[2]-b[0])*1000,height:(b[3]-b[1])*1000,class:'privacy-auto-region','data-id':c.id,'data-box':i,'data-selected':c.selected,'data-active':c.id===active,tabindex:c.id===active?'0':'-1',role:'button','aria-label':PDFPrivacyDetect.TYPES.find(t=>t.id===c.type)?.label+' 영역. 방향키로 위치 조절'});svg.append(rect);
    }
    const c=entry().candidates.find(c=>c.id===active);if(!c)return;const bounds=svg.getBoundingClientRect();
    c.boxes.forEach((b,i)=>{for(const [x,y,corner]of [[b[0],b[1],'nw'],[b[2],b[1],'ne'],[b[2],b[3],'se'],[b[0],b[3],'sw']])for(const size of [44,10]){
      const w=size*1000/Math.max(bounds.width,1),h=size*1000/Math.max(bounds.height,1),n=svgNode('rect',{x:x*1000-w/2,y:y*1000-h/2,width:w,height:h,class:'privacy-auto-handle','data-id':c.id,'data-box':i,'data-corner':corner,'data-size':size});if(size===44){n.style.fill='transparent';n.style.stroke='none';}svg.append(n);
    }});
  }
  function activate(c,scroll=false){active=c.id;const index=entry().candidates.indexOf(c);if(index>=shown){shown=Math.ceil((index+1)/50)*50;renderCandidates();}for(const n of el('Candidates').children)n.dataset.active=String(n.dataset.id===active);renderOverlay();if(scroll){const host=el('Candidates'),row=host.querySelector('[data-id="'+CSS.escape(c.id)+'"]');if(row){const r=row.getBoundingClientRect(),h=host.getBoundingClientRect();if(r.top<h.top)host.scrollTop+=r.top-h.top;else if(r.bottom>h.bottom)host.scrollTop+=r.bottom-h.bottom;}}}
  function selectionChanged(){if(entry())confirmed.delete(entry().uid);sync();renderOverlay();}
  function renderCandidates(){
    const host=el('Candidates');host.replaceChildren();if(!entry())return;
    for(const c of entry().candidates.slice(0,shown)){
      const row=document.createElement('div'),input=document.createElement('input'),check=document.createElement('label'),body=document.createElement('button');row.className='privacy-auto-candidate';row.dataset.id=c.id;row.dataset.active=String(c.id===active);row.dataset.selected=String(c.selected);check.className='privacy-auto-candidate-check';check.append(input);
      input.type='checkbox';input.checked=c.selected;input.setAttribute('aria-label',c.text+' 가리기');input.onchange=()=>{if(working){input.checked=c.selected;return;}c.selected=input.checked;row.dataset.selected=String(c.selected);activate(c);selectionChanged();};
      body.type='button';body.className='privacy-auto-candidate-body';body.style.cssText='border:0;background:none;color:inherit;font:inherit;text-align:left;padding:0;cursor:pointer';
      for(const [cls,text]of [['kind',PDFPrivacyDetect.TYPES.find(t=>t.id===c.type)?.label||c.type],['text',c.text+' → '+c.maskedText],['meta',c.approximate?'위치 추정 · 경계 확인':'OCR 영역']]){const span=document.createElement('span');span.className='privacy-auto-'+cls;span.textContent=text;body.append(span);}body.onclick=()=>{if(!working)activate(c);};row.append(check,body);host.append(row);
    }
    el('More').hidden=shown>=entry().candidates.length;el('More').textContent='다음 '+Math.min(50,entry().candidates.length-shown)+'개 보기';
  }
  async function verifyEntry(e){
    const o=readProOptions(false,[]),snapshot=JSON.stringify(e.record);
    if(!pages.includes(e.page)||!ocrRecords.includes(e.record)||!ocrRecordCurrent(e.record,e.page,o)||!geometrySafe(o,[e.page])||await digestText(snapshot)!==e.hash)throw Error('문서나 OCR 결과가 바뀌었습니다. 탐지를 다시 실행하세요.');
    if(!pages.includes(e.page)||!ocrRecords.includes(e.record)||!ocrRecordCurrent(e.record,e.page,readProOptions(false,[]))||JSON.stringify(e.record)!==snapshot)throw Error('문서가 변경되었습니다. 탐지를 다시 실행하세요.');
    return snapshot;
  }
  async function showPage(index){
    cancelWork();const token=sequence,abort=controller=new AbortController();pageIndex=index;shown=50;active=entry()?.candidates[0]?.id;el('Page').value=String(index);renderCandidates();sync();status('ReviewStatus','원본을 불러오는 중…');
    let canvas;
    try{
      await verifyEntry(entry());abort.signal.throwIfAborted();canvas=await renderOCRCorrectionPage(entry().record,{signal:abort.signal});abort.signal.throwIfAborted();
      const target=el('Canvas');target.width=canvas.width;target.height=canvas.height;target.getContext('2d').drawImage(canvas,0,0);ready=true;renderOverlay();
      status('ReviewStatus','영역을 끌거나 모서리로 크기를 조절하세요. 자동 탐지에는 누락·오탐이 있을 수 있습니다.');
    }catch(e){if(token===sequence&&e.name!=='AbortError'){confirmed.delete(entry().uid);status('ReviewStatus',e.message||'원본을 표시하지 못했습니다.',true);}}
    finally{if(canvas)canvas.width=canvas.height=0;if(token===sequence)sync();}
  }
  el('Page').onchange=()=>{if(!working)showPage(Number(el('Page').value));};el('Prev').onclick=()=>{if(!working&&pageIndex>0)return showPage(pageIndex-1);};el('Next').onclick=()=>{if(!working&&pageIndex<entries.length-1)return showPage(pageIndex+1);};
  el('More').onclick=()=>{if(working)return;shown+=50;renderCandidates();};
  el('SelectPage').onclick=()=>{if(working||!entry())return;entry().candidates.forEach(c=>c.selected=true);selectionChanged();renderCandidates();};
  el('ClearSelection').onclick=()=>{if(working)return;entries.forEach(e=>e.candidates.forEach(c=>c.selected=false));confirmed.clear();sync();renderCandidates();renderOverlay();};
  el('PageConfirm').onchange=()=>{if(working||!ready||gesture||!entry())return;if(el('PageConfirm').checked)confirmed.add(entry().uid);else confirmed.delete(entry().uid);sync();};
  const point=event=>{const b=el('Overlay').getBoundingClientRect();return [(event.clientX-b.left)/b.width,(event.clientY-b.top)/b.height];};
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  el('Overlay').onpointerdown=event=>{
    if(!ready||working||event.button!==0||gesture)return;const target=event.target.closest('[data-id]'),c=entry().candidates.find(c=>c.id===target?.dataset.id);if(!c)return;
    const corner=target.dataset.corner,index=Number(target.dataset.box),start=point(event);activate(c,true);gesture={c,index,corner,start,box:[...c.boxes[index]],pointer:event.pointerId};el('Overlay').setPointerCapture(event.pointerId);dialog.dataset.dragging='true';event.preventDefault();sync();
  };
  el('Overlay').onpointermove=event=>{
    if(!gesture||event.pointerId!==gesture.pointer)return;const g=gesture,p=point(event),b=[...g.box],dx=p[0]-g.start[0],dy=p[1]-g.start[1];
    if(g.corner){if(g.corner.includes('w'))b[0]=clamp(b[0]+dx,0,b[2]-.001);else b[2]=clamp(b[2]+dx,b[0]+.001,1);if(g.corner.includes('n'))b[1]=clamp(b[1]+dy,0,b[3]-.001);else b[3]=clamp(b[3]+dy,b[1]+.001,1);}
    else{const x=clamp(dx,-b[0],1-b[2]),y=clamp(dy,-b[1],1-b[3]);b[0]+=x;b[2]+=x;b[1]+=y;b[3]+=y;}
    g.c.boxes[g.index]=b;confirmed.delete(entry().uid);updateActiveOverlay(g.c);event.preventDefault();
  };
  function updateActiveOverlay(candidate){
    const svg=el('Overlay'),bounds=svg.getBoundingClientRect();
    for(const node of svg.querySelectorAll('[data-id="'+CSS.escape(candidate.id)+'"]')){
      const box=candidate.boxes[Number(node.dataset.box)],corner=node.dataset.corner;
      if(corner){const size=Number(node.dataset.size),w=size*1000/Math.max(bounds.width,1),h=size*1000/Math.max(bounds.height,1);node.setAttribute('x',(corner.includes('w')?box[0]:box[2])*1000-w/2);node.setAttribute('y',(corner.includes('n')?box[1]:box[3])*1000-h/2);}
      else{node.setAttribute('x',box[0]*1000);node.setAttribute('y',box[1]*1000);node.setAttribute('width',(box[2]-box[0])*1000);node.setAttribute('height',(box[3]-box[1])*1000);}
    }
  }
  function finishPointer(event,cancel=false){if(!gesture||event.pointerId!==gesture.pointer)return;const g=gesture;gesture=null;if(cancel)g.c.boxes[g.index]=g.box;dialog.dataset.dragging='false';if(el('Overlay').hasPointerCapture(g.pointer))el('Overlay').releasePointerCapture(g.pointer);renderOverlay();sync();}
  el('Overlay').onpointerup=e=>finishPointer(e);el('Overlay').onpointercancel=e=>finishPointer(e,true);el('Overlay').onlostpointercapture=e=>finishPointer(e,true);
  el('Overlay').onkeydown=event=>{
    if(!ready||working||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;const target=event.target.closest('[data-id]'),c=entry().candidates.find(c=>c.id===target?.dataset.id);if(!c)return;event.preventDefault();const b=c.boxes[Number(target.dataset.box)],step=event.shiftKey?.01:.001,dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0,x=clamp(dx,-b[0],1-b[2]),y=clamp(dy,-b[1],1-b[3]);c.boxes[Number(target.dataset.box)]=[b[0]+x,b[1]+y,b[2]+x,b[3]+y];selectionChanged();el('Overlay').querySelector('[data-id="'+CSS.escape(c.id)+'"][data-box="'+target.dataset.box+'"]')?.focus();
  };
  el('Apply').onclick=async()=>{
    if(working||el('Apply').disabled)return;const token=sequence;notices.delete('Status');working=true;sync();status('Status','확인한 영역을 적용하는 중…');
    try{
      const touched=entries.filter(e=>e.candidates.some(c=>c.selected)),reviewed=new Map();
      for(const e of touched){reviewed.set(e,await verifyEntry(e));if(token!==sequence)return;}
      await PDFPrivacy.assertSupportedSources(pages,docs);if(token!==sequence)return;
      // Recheck synchronously after the last await. No document mutation precedes this point.
      const o=readProOptions(false,[]);if(touched.some(e=>!pages.includes(e.page)||!ocrRecords.includes(e.record)||!ocrRecordCurrent(e.record,e.page,o)||!confirmed.has(e.uid)||JSON.stringify(e.record)!==reviewed.get(e))||!geometrySafe(o,touched.map(e=>e.page)))throw Error('문서가 변경되었습니다. 탐지를 다시 실행하세요.');
      let nextId=annoUidSeq;
      const changes=touched.map(e=>{
        const additions=e.candidates.filter(c=>c.selected).flatMap(c=>c.boxes.map(b=>({id:'a'+(++nextId),shape:'redaction',nx:b[0],ny:b[1],nw:b[2]-b[0],nh:b[3]-b[1],fill:'#111111',stroke:'none',lineWidth:0,opacity:1})));
        const annots=[...(e.page.annots||[]),...additions],masks=annots.filter(a=>a.shape==='redaction').map(a=>[a.nx,a.ny,a.nx+a.nw,a.ny+a.nh]),copy={...e.page,annots};
        const record=PDFPrivacyAutoModel.sanitizeRecord(e.record,masks,PDFOCR.correctionWords);record.key=ocrKey(copy,o);record.privacyKey=PDFPrivacy.maskKey(copy);
        return {e,annots,record};
      });
      const before=captureEditHistory();before.pageOcr=changes.map(({e})=>({uid:e.uid,record:e.record}));before.extraBytes=JSON.stringify(before.pageOcr).length*2;
      const replacements=new Map(changes.map(c=>[c.e.uid,c.record]));
      const rollback={annots:changes.map(c=>[c.e.page,c.e.page.annots]),records:ocrRecords,sequence:annoUidSeq,checkpoints:[...ocrCheckpoints],undo:editHistory.undo.slice(),redo:editHistory.redo.slice()};
      try{
        for(const c of changes)c.e.page.annots=c.annots;annoUidSeq=nextId;ocrRecords=ocrRecords.map(r=>replacements.get(r.uid)||r);
        for(const [key,record]of ocrCheckpoints)if(replacements.has(record.uid))ocrCheckpoints.delete(key);
        const after=captureEditHistory();after.pageOcr=changes.map(c=>({uid:c.e.uid,record:c.record}));after.extraBytes=JSON.stringify(after.pageOcr).length*2;
        editHistory.push(before,after,'개인정보 자동 마스킹');
      }catch(error){
        for(const [page,annots]of rollback.annots)page.annots=annots;ocrRecords=rollback.records;annoUidSeq=rollback.sequence;
        ocrCheckpoints.clear();for(const [key,record]of rollback.checkpoints)ocrCheckpoints.set(key,record);
        editHistory.undo=rollback.undo;editHistory.redo=rollback.redo;throw error;
      }
      collectHistoryDocuments();syncHistoryControls();
      close();renderOCRResults();renderAnnots();toolsChanged();syncCounts();syncPrivacy();
      toast(changes.length+'페이지에 가릴 영역을 적용했습니다. 가린 내용은 검색 텍스트에서도 제외됩니다.');
    }catch(e){if(token===sequence)notice('Status',e.message||'영역을 적용하지 못했습니다.',true);}
    finally{if(token===sequence){working=false;sync();}}
  };
  syncPrivacyAuto();
})();
