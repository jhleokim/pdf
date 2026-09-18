/* Page actions share the editor's selection, export and undo transactions. */
async function duplicatePages(list){
  await textUpdate;
  if(document.body.classList.contains('is-busy')||ocrRunning||!finishTextEdit(true))return;
  const chosen=new Set(list.map(p=>p.uid)),originals=pages.filter(p=>chosen.has(p.uid));
  if(!originals.length)return;
  finishReviewStampForNavigation();
  const options=readProOptions(),before=captureEditHistory(),positions=captureBoardPositions();
  busy(true,'페이지를 복제하는 중…');
  try{
  const copies=[],records=[],byUid=new Map(ocrRecords.map(r=>[r.uid,r]));let extraBytes=0;
  const at=pages.indexOf(originals.at(-1))+1;
  const nextOptions={...options,deskewAngles:{...options.deskewAngles},deskewCropByPage:{...options.deskewCropByPage}};
  for(let i=0;i<originals.length;i++){
    const p=originals[i],copy={...p,uid:'p'+(++uidSeq),el:null,canvas:null,
      thumbRatio:p.thumbRatio||(p.canvas?.height?p.canvas.width/p.canvas.height:Math.SQRT1_2),
      annots:structuredClone(p.annots||[]).map(a=>({...a,id:'a'+(++annoUidSeq)}))};
    copies.push(copy);
    if(Number.isFinite(p.deskewAngle))nextOptions.deskewAngles[copy.uid]=p.deskewAngle;
    if(p.deskewCrop===true)nextOptions.deskewCropByPage[copy.uid]=true;
    const record=byUid.get(p.uid);
    if(record&&ocrRecordCurrent(record,p,options)){
      const cloned=structuredClone(record);cloned.uid=copy.uid;cloned.key=ocrKey(copy,nextOptions);cloned.page=at+i+1;
      if(cloned.privacyKey)cloned.privacyKey=PDFPrivacy.maskKey(copy);
      records.push(cloned);extraBytes+=JSON.stringify(cloned).length*2;
    }
    // OCR-rich pages can carry thousands of word boxes. Yield while preparing
    // the new transaction, before changing the visible document or stamp scope.
    if(i%8===7){progress((i+1)/originals.length*90);await idle();}
  }
  // Reuse the source PDF, not a rendered page. Canvases belong to the bounded
  // thumbnail cache and must never be shared (eviction clears their pixels).
  const ids=new Map(originals.map((p,i)=>[p.uid,copies[i].uid]));
  const extend=mark=>!mark||mark.scope==='all'?mark:{...mark,targets:[...(mark.targets||[]),...(mark.targets||[]).filter(id=>ids.has(id)).map(id=>ids.get(id))]};
  stampMarks=stampMarks.map(extend);stampAsset=extend(stampAsset);
  if(stampEditing)stampEditing={...stampEditing,mark:extend(stampEditing.mark)};
  pages=[...pages.slice(0,at),...copies,...pages.slice(at)];
  ocrRecords=ocrRecords.concat(records);render();copies.forEach(p=>p.el.classList.add('selected'));
  lastClicked=at;syncCounts();toolsChanged();animateBoardFrom(positions,copies[0].uid);
  const after=captureEditHistory();after.previewUid=copies[0].uid;
  // Only these new OCR records belong to this undo entry; unrelated results
  // recognized later must not be overwritten when undoing page duplication.
  before.pageOcr=copies.map(p=>({uid:p.uid,record:null}));
  const copiedRecords=new Map(records.map(r=>[r.uid,r]));
  after.pageOcr=copies.map(p=>({uid:p.uid,record:copiedRecords.get(p.uid)||null}));after.extraBytes=extraBytes;
  editHistory.push(before,after,'페이지 복제');collectHistoryDocuments();syncHistoryControls();
  await showPreview(copies[0]);copies[0].el.focus({preventScroll:true});copies[0].el.scrollIntoView({block:'nearest',inline:'nearest'});
  toast(copies.length+'페이지를 복제했습니다');
  }finally{progress(0);busy(false);}
}

(()=>{
  const menu=document.createElement('div');menu.id='pageContextMenu';menu.className='page-context-menu';menu.hidden=true;
  menu.setAttribute('role','menu');menu.setAttribute('aria-label','페이지 작업');
  const actions=[
    ['preview','크게 보기','#i-expand'],
    ['rotate-left','왼쪽으로 회전','#i-rot-l'],['rotate-right','오른쪽으로 회전','#i-rot-r'],
    ['duplicate','복제','#i-file'],['reorder','순서 변경','#i-grid'],
    ['blank-before','앞에 빈 페이지','#i-file'],['blank-after','뒤에 빈 페이지','#i-file'],
    ['save','선택 페이지 저장','#i-save'],['delete','삭제','#i-trash']
  ];
  const heading=document.createElement('div');heading.className='page-context-heading';heading.setAttribute('role','presentation');menu.append(heading);
  for(const [action,label,icon]of actions){
    if(['rotate-left','blank-before','save','delete'].includes(action)){const divider=document.createElement('div');divider.className='page-context-divider';divider.setAttribute('role','separator');menu.append(divider);}
    const button=document.createElement('button');button.type='button';button.dataset.action=action;button.tabIndex=-1;button.setAttribute('role','menuitem');
    button.innerHTML='<svg class="ic" aria-hidden="true"><use href="'+icon+'"/></svg><span>'+label+'</span>';
    if(action==='delete')button.className='danger';menu.append(button);
  }
  document.body.append(menu);
  let targetUid=null,targets=[],opener=null;
  const blocked=()=>document.body.classList.contains('is-busy')||ocrRunning||!!proAbort||!!document.querySelector('dialog[open]');
  function close(focus=false){
    if(menu.hidden)return;
    menu.hidden=true;opener?.setAttribute('aria-expanded','false');
    const card=pages.find(p=>p.uid===targetUid)?.el;
    if(focus)(opener?.isConnected?opener:card)?.focus({preventScroll:true});
    targets=[];targetUid=null;opener=null;
  }
  function open(card,x,y,button=null){
    if(blocked())return;
    const p=pages.find(p=>p.uid===card.dataset.uid);if(!p)return;
    close();
    if(!card.classList.contains('selected')){
      pages.forEach(item=>item.el.classList.toggle('selected',item===p));lastClicked=pages.indexOf(p);syncCounts();void showPreview(p);
    }
    targetUid=p.uid;targets=selected().map(item=>item.uid);opener=button||card;
    heading.textContent=targets.length>1?targets.length+'페이지 선택':(pages.indexOf(p)+1)+'페이지';
    menu.querySelector('[data-action=reorder]').disabled=pages.length<2||targets.length===pages.length;
    opener.setAttribute('aria-expanded','true');menu.hidden=false;menu.style.left='0px';menu.style.top='0px';
    const r=menu.getBoundingClientRect(),v=window.visualViewport,left=v?.offsetLeft||0,top=v?.offsetTop||0;
    menu.style.left=Math.max(left+8,Math.min(x,left+(v?.width||innerWidth)-r.width-8))+'px';
    menu.style.top=Math.max(top+8,Math.min(y,top+(v?.height||innerHeight)-r.height-8))+'px';
    menu.querySelector('button:not(:disabled)').focus({preventScroll:true});
  }
  board.addEventListener('contextmenu',e=>{
    const card=e.target.closest('.page');if(!card)return;e.preventDefault();
    if(typeof tdrag!=='undefined'&&tdrag?.active)return;
    const r=card.getBoundingClientRect();open(card,e.clientX||r.left+24,e.clientY||r.top+24);
  });
  // Capture before the card's normal click handler can change the selection.
  board.addEventListener('click',e=>{
    const button=e.target.closest('[data-act=menu]');if(!button)return;e.preventDefault();e.stopPropagation();
    if(!menu.hidden&&opener===button){close(true);return;}
    const r=button.getBoundingClientRect();open(button.closest('.page'),r.right,r.bottom+4,button);
  },true);
  board.addEventListener('keydown',e=>{
    if(e.key!=='ContextMenu'&&!(e.shiftKey&&e.key==='F10'))return;
    const card=e.target.closest('.page');if(!card)return;e.preventDefault();e.stopPropagation();const r=card.getBoundingClientRect();open(card,r.left+24,r.top+24);
  });
  menu.addEventListener('keydown',e=>{
    e.stopPropagation();
    if(e.key==='Escape'){e.preventDefault();close(true);return;}
    if(e.key==='Tab'){close(true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
    e.preventDefault();const items=[...menu.querySelectorAll('button:not(:disabled)')],i=items.indexOf(document.activeElement);
    items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();
  });
  menu.addEventListener('pointermove',e=>{const item=e.target.closest('button:not(:disabled)');if(item&&e.pointerType==='mouse')item.focus({preventScroll:true});});
  menu.addEventListener('click',async e=>{
    const button=e.target.closest('button[data-action]');if(!button||button.disabled||blocked())return;
    const chosen=new Set(targets),list=pages.filter(p=>chosen.has(p.uid)),p=pages.find(p=>p.uid===targetUid),action=button.dataset.action;close(true);
    if(!list.length||!p)return;
    try{
      await textUpdate;if(blocked())return;
      if(action==='preview'){if(isMobile()){await showPreview(p);if(proMode==='pro'){setLivePreviewOpen(true);setProView('workspace');}else setMobileView('preview');}else await preview(p);}
      else if(action==='rotate-left'||action==='rotate-right'){rotate(list,action==='rotate-left'?-90:90);p.el?.focus({preventScroll:true});}
      else if(action==='duplicate')await duplicatePages(list);
      else if(action==='reorder')pageOrderButton.click();
      else if(action==='blank-before'||action==='blank-after')await insertBlankPage({beforeUid:action==='blank-before'?list[0].uid:pages[pages.indexOf(list.at(-1))+1]?.uid||null});
      else if(action==='save')await openBasicSaveDialog({scope:'selected'});
      else if(action==='delete')remove(list);
    }catch(error){console.error(error);toast('페이지 작업을 완료하지 못했습니다. 다시 시도해 주세요.',true);}
  });
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!e.target.closest('[data-act=menu]'))close(!e.target.closest('button,input,a,textarea,select,.page'));},true);
  document.addEventListener('scroll',e=>{if(!menu.contains(e.target))close(true);},true);
  board.addEventListener('dragstart',()=>close());window.addEventListener('resize',()=>close(true));window.addEventListener('blur',()=>close());
  document.addEventListener('focusin',e=>{if(!menu.hidden&&!menu.contains(e.target))close();});
  new MutationObserver(()=>close()).observe(board,{childList:true});
})();
