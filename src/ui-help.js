/* Context help: mouse hover, keyboard focus, or touch and hold. No network. */
(() => {
  const tooltip=document.createElement('div');tooltip.id='contextHelp';tooltip.className='context-help';tooltip.role='tooltip';tooltip.hidden=true;document.body.append(tooltip);
  const HOVER_DELAY_MS=1000,TOUCH_DELAY_MS=320;
  let active=null,timer=null,origin=null,keyboard=true;
  const hide=()=>{clearTimeout(timer);timer=null;origin=null;if(active)active.removeAttribute('aria-describedby');active=null;tooltip.hidden=true;};
  const show=button=>{hide();const text=button.dataset.helpFor.split(' ').map(id=>document.getElementById(id)).filter(source=>source&&!source.hidden).map(source=>source.textContent.trim()).filter(Boolean).join('\n\n');if(!text)return;
    // Body children are inert behind a modal's top layer, regardless of z-index.
    const host=button.closest('dialog[open]')||document.body;if(tooltip.parentNode!==host)host.append(tooltip);
    active=button;tooltip.textContent=text;tooltip.hidden=false;button.setAttribute('aria-describedby',tooltip.id);const r=button.getBoundingClientRect(),w=tooltip.offsetWidth,h=tooltip.offsetHeight;tooltip.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left-8))+'px';tooltip.style.top=(r.bottom+h+14<innerHeight?r.bottom+8:Math.max(8,r.top-h-8))+'px';};
  let seq=0;
  for(const source of document.querySelectorAll('.pro-hint:not([role]),.pro-panel-head p,.pdf-save-note,.compare-details,.deskew-direction')){
    if(!source.textContent.trim()||source.closest('.gemini-dialog')||['privacyStatus','ocrConfidence'].includes(source.id))continue;
    source.id||='help-source-'+(++seq);source.classList.add('help-source');let anchor=source.previousElementSibling;
    if(source.matches('.pdf-save-note'))anchor=source.parentElement.querySelector('.pdf-filename-label')||source.parentElement;
    else if(anchor?.matches('label'))anchor=anchor.querySelector('span')||anchor;
    else{const summary=source.closest('details')?.querySelector(':scope > summary');anchor=summary?.querySelector(':scope > span:nth-child(2)')||summary||source.parentElement.querySelector('h2,label')||source.parentElement;}
    const previous=anchor.querySelector(':scope > .help-dot');if(previous){previous.dataset.helpFor+=' '+source.id;continue;}
    const button=document.createElement('button');button.type='button';button.className='help-dot';button.textContent='?';button.setAttribute('aria-label','도움말');button.dataset.helpFor=source.id;anchor.append(button);
    button.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){hide();timer=setTimeout(()=>{if(button.isConnected&&button.getClientRects().length)show(button);},HOVER_DELAY_MS);}});button.addEventListener('pointerleave',hide);
    button.addEventListener('focus',()=>{if(keyboard)show(button);});button.addEventListener('blur',hide);
    button.addEventListener('pointerdown',e=>{e.stopPropagation();if(e.pointerType==='touch'){hide();origin={x:e.clientX,y:e.clientY};timer=setTimeout(()=>{const start=origin;show(button);origin=start;},TOUCH_DELAY_MS);}});
    button.addEventListener('pointermove',e=>{if(origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>8)hide();});
    button.addEventListener('pointerup',e=>{if(e.pointerType==='touch')hide();origin=null;});button.addEventListener('pointercancel',hide);button.addEventListener('contextmenu',e=>e.preventDefault());button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});
  }
  document.addEventListener('pointerdown',()=>{keyboard=false;},true);
  document.addEventListener('keydown',e=>{keyboard=true;if(e.key==='Escape')hide();},true);window.addEventListener('resize',hide);document.addEventListener('scroll',hide,true);
  window.addEventListener('blur',hide);document.addEventListener('visibilitychange',()=>{if(document.hidden)hide();});
  document.addEventListener('close',e=>{if(active&&e.target.contains(active))hide();},true);
})();
