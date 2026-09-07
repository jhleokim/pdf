/* Resizable page navigator; only the preferred width is persisted. */
let proRailDragging=false;
(() => {
  const handle=$('proRailDivider'),main=document.querySelector('main');
  let preferred=null,drag=null;
  try{const n=Number(localStorage.getItem('pdfed-pro-rail-width'));if(n>=120&&n<=520)preferred=n;}catch(_){}
  const defaultWidth=()=>innerWidth<=1100?140:180;
  function limits(){
    const panel=parseFloat(getComputedStyle(document.body).getPropertyValue('--pro-width'))||342;
    return {min:120,max:Math.max(120,Math.min(520,Math.floor(main.clientWidth-panel-328)))};
  }
  function apply(value=preferred??defaultWidth()){
    const {min,max}=limits(),width=Math.max(min,Math.min(max,value));
    main.style.setProperty('--pro-rail-width',width+'px');
    main.style.setProperty('--pro-thumb-columns',Math.max(1,Math.floor((width-8)/154)));
    handle.setAttribute('aria-valuemin',min);handle.setAttribute('aria-valuemax',max);handle.setAttribute('aria-valuenow',Math.round(width));
    return width;
  }
  function save(){try{if(preferred===null)localStorage.removeItem('pdfed-pro-rail-width');else localStorage.setItem('pdfed-pro-rail-width',preferred);}catch(_) {}}
  function finish(cancel=false){
    if(!drag)return;
    if(cancel){preferred=drag.preferred;apply();}else save();
    const id=drag.id;drag=null;proRailDragging=false;document.body.classList.remove('pro-rail-resizing');
    if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);
    if(typeof syncLivePreview==='function')syncLivePreview();
  }
  handle.onpointerdown=e=>{
    if(e.button!==0||innerWidth<=880)return;
    e.preventDefault();drag={id:e.pointerId,x:e.clientX,width:apply(),preferred};proRailDragging=true;
    document.body.classList.add('pro-rail-resizing');handle.setPointerCapture(e.pointerId);handle.focus();
  };
  handle.onpointermove=e=>{if(drag&&e.pointerId===drag.id)preferred=apply(drag.width+e.clientX-drag.x);};
  handle.onpointerup=()=>finish();handle.onpointercancel=()=>finish(true);handle.onlostpointercapture=()=>finish(true);
  handle.ondblclick=()=>{preferred=null;apply();save();};
  handle.onkeydown=e=>{
    if(e.key==='Escape'&&drag){e.preventDefault();e.stopPropagation();finish(true);return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();
    if(e.key==='Home')preferred=null;
    else preferred=e.key==='End'?limits().max:apply()+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?64:24);
    if(preferred!==null)preferred=apply();else apply();save();
  };
  new ResizeObserver(()=>{if(!drag)apply();}).observe(main);apply();
})();
