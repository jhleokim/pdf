/* Appearance preferences are local UI state; never touch document rendering. */
(()=>{
 'use strict';
 const styles=['studio','paper'],modes=['light','dark','auto'];
 const names={studio:'Studio',paper:'Paper',light:'Light',dark:'Dark',auto:'시스템'};
 const icons={light:'#i-sun',dark:'#i-moon',auto:'#i-auto'};
 const read=(key,values,fallback)=>{try{const v=localStorage.getItem(key);return values.includes(v)?v:fallback;}catch{return fallback;}};
 let style=read('pdfstudio-appearance-v1',styles,'studio'),mode=read('pdfed-theme-v2',modes,'light'),initialized=false;
 const media=matchMedia('(prefers-color-scheme: dark)');
 function apply(){
  const root=document.documentElement,resolved=mode==='auto'?(media.matches?'dark':'light'):mode;
  root.dataset.appearance=style;root.dataset.theme=resolved;
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=getComputedStyle(root).getPropertyValue('--paper').trim();
  const button=document.getElementById('btnTheme');
  button.title=`화면 설정 · ${names[style]} · ${names[mode]}`;button.setAttribute('aria-label',button.title);
  document.querySelector('#themeIcon use').setAttribute('href',icons[mode]);
  for(const b of document.querySelectorAll('[data-appearance]'))if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.appearance===style));
  for(const b of document.querySelectorAll('[data-color-mode]'))b.setAttribute('aria-pressed',String(b.dataset.colorMode===mode));
 }
 function init(){
  if(initialized)return;initialized=true;
  const button=document.getElementById('btnTheme'),dialog=document.getElementById('appearanceDialog');
  button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls',dialog.id);button.setAttribute('aria-expanded','false');
  const place=()=>{if(!dialog.open)return;const r=button.getBoundingClientRect(),width=dialog.offsetWidth,height=dialog.offsetHeight;
   dialog.style.left=Math.max(12,Math.min(innerWidth-width-12,r.right-width))+'px';
   dialog.style.top=Math.max(12,Math.min(innerHeight-height-12,r.bottom+8))+'px';
  };
  button.onclick=()=>{if(dialog.open){dialog.close();return;}dialog.showModal();button.setAttribute('aria-expanded','true');place();dialog.querySelector(`[data-appearance="${style}"]`).focus({preventScroll:true});};
  document.getElementById('appearanceClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{button.setAttribute('aria-expanded','false');button.focus({preventScroll:true});});
  let outside=false;
  const isOutside=e=>{const r=dialog.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
  dialog.addEventListener('pointerdown',e=>{outside=e.target===dialog&&isOutside(e);});
  dialog.addEventListener('click',e=>{if(outside&&e.target===dialog&&isOutside(e))dialog.close();outside=false;});
  dialog.addEventListener('click',e=>{
   const b=e.target.closest('[data-appearance],[data-color-mode]');if(!b)return;
   if(b.dataset.appearance){style=b.dataset.appearance;try{localStorage.setItem('pdfstudio-appearance-v1',style);}catch{}}
   else{mode=b.dataset.colorMode;try{localStorage.setItem('pdfed-theme-v2',mode);}catch{}}
   apply();
  });
  window.addEventListener('resize',place,{passive:true});
  media.addEventListener('change',()=>{if(mode==='auto')apply();});
  apply();
 }
 globalThis.PDFStudioAppearance={init};
})();
