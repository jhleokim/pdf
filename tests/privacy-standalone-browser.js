/* Runs inside the actual standalone build, including an opaque-origin frame. */
(async()=>{
 const out=document.createElement('pre');out.id='standalonePrivacyChecks';out.style='position:fixed;bottom:0;left:0;max-height:38vh;overflow:auto;z-index:99999;background:white;color:black;padding:12px;font:12px monospace';document.body.append(out);
 const lines=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const show=s=>{out.textContent=lines.join('\n')+'\n'+s;if(parent!==self)parent.postMessage({privacyQA:out.textContent},'*');};
 const check=(ok,label)=>{if(!ok)throw Error(label);lines.push('PASS '+label);show('');};
 const pixel=(c,nx,ny)=>[...c.getContext('2d').getImageData(Math.floor(c.width*nx),Math.floor(c.height*ny),1,1).data].slice(0,3);
 const gray=p=>Math.max(...p)-Math.min(...p)<3;
 async function preview(){
  scheduleLivePreview();
  for(let i=0;i<600;i++){
   await sleep(25);
   if($('compareState').textContent==='미리보기 업데이트 완료')return;
   if($('compareState').textContent==='미리보기를 업데이트하지 못했습니다')throw Error($('compareNote').textContent);
  }
  throw Error('Preview did not finish');
 }
 async function save(){
  const pending=createProResult({reveal:false});let settled=false;pending.finally(()=>settled=true).catch(()=>{});
  for(let i=0;i<400&&!settled;i++){
   if($('documentCheckDialog').open){$('documentCheckAccept').checked=true;$('documentCheckAccept').dispatchEvent(new Event('change'));$('documentCheckContinue').click();break;}
   await sleep(25);
  }
  const result=await pending;if(!result?.bytes)throw Error('Save failed: '+$('proStatus').textContent);return result.bytes;
 }
 async function inspect(bytes,masked,bw){
  const task=pdfjsLib.getDocument({data:bytes.slice(),...DOC_OPTS});
  try{
   const d=await task.promise;check(d.numPages===2,'Saved both pages');
   for(let i=1;i<=2;i++){
    const p=await d.getPage(i),text=(await p.getTextContent()).items.map(t=>t.str).join('');
    check(text.includes('PUBLIC'),'Searchable public text remains on page '+i);
    check(text.includes('SECRET')===(i===2||!masked),'Only masked text removed on page '+i);
    const v=p.getViewport({scale:1}),c=document.createElement('canvas');c.width=v.width;c.height=v.height;await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;
    check(gray(pixel(c,.75,.5))===bw,'Saved '+(i===1?'JPEG':'PNG')+' image has expected color');
    if(i===1&&masked)check(pixel(c,.2,.46).every(n=>n<5),'Saved image mask remains opaque');
    c.width=c.height=0;
   }
  }finally{await task.destroy();}
 }
 try{
  show('Preparing '+self.origin);
  const d=await PDFLib.PDFDocument.create(),c=document.createElement('canvas');c.width=800;c.height=900;
  const ctx=c.getContext('2d');ctx.fillStyle='#196ec8';ctx.fillRect(0,0,800,900);ctx.fillStyle='#f4cd76';ctx.fillRect(0,450,400,450);ctx.fillStyle='white';ctx.font='40px sans-serif';ctx.fillText('SCAN COLOR',60,350);
  for(const type of ['image/jpeg','image/png']){
   const b=await new Promise(r=>c.toBlob(r,type,.88)),im=type==='image/jpeg'?await d.embedJpg(await b.arrayBuffer()):await d.embedPng(await b.arrayBuffer());
   const p=d.addPage([400,600]);p.drawImage(im,{x:0,y:70,width:400,height:450});p.drawText('SECRET',{x:30,y:545,size:20});p.drawText('PUBLIC',{x:30,y:35,size:20});
  }
  await loadFiles([new File([await d.save()],'privacy-color-fixture.pdf',{type:'application/pdf'})]);await setProMode('pro');
  $('proOptimize').checked=false;$('proDeskew').checked=false;$('proGrayscale').checked=true;refreshProControls();
  await preview();check(gray(pixel($('compareAfter'),.75,.5)),'B&W alone updates current preview');check(!gray(pixel($('compareBefore'),.75,.5)),'Original preview retains color');
  await inspect(await save(),false,true);
  const first=pages[0];first.annots=[{id:'mask-text',shape:'redaction',nx:.05,ny:.055,nw:.65,nh:.065},{id:'mask-image',shape:'redaction',nx:.1,ny:.4,nw:.2,nh:.15}];
  $('proGrayscale').checked=false;proInvalidate();refreshProControls();await preview();
  check(pixel($('compareAfter'),.2,.46).every(n=>n<5),'Redaction updates current preview');check(!gray(pixel($('compareAfter'),.75,.5)),'Redaction preserves color elsewhere');
  await inspect(await save(),true,false);
  $('proGrayscale').checked=true;$('proGrayscale').dispatchEvent(new Event('change',{bubbles:true}));await preview();
  check(gray(pixel($('compareAfter'),.75,.5)),'B&W combined with redaction updates preview');
  check(pixel($('compareAfter'),.2,.46).every(n=>n<5),'Combined preview retains image mask');
  await inspect(await save(),true,true);
  PDFPrivacyNative.dispose();const abort=new AbortController();const canceled=PDFPrivacyNative.run(await d.save(),[[],[]],{signal:abort.signal});setTimeout(()=>abort.abort(),0);
  let aborted=false;try{await canceled;}catch(e){aborted=e.name==='AbortError';}check(aborted,'Cancel during cold startup');
  const recovered=await PDFPrivacyNative.run(await d.save(),[[],[]]);check(recovered.bytes.length>0,'Retry after cancel succeeds');
  const bad=await PDFPrivacyNative.run(new Uint8Array([1,2,3]),[[],[]]).then(()=>false,()=>true);check(bad,'Invalid document returns an error');
  check((await PDFPrivacyNative.run(await d.save(),[[],[]])).bytes.length>0,'Worker accepts valid document after an error');
  const requests=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name));
  if(self.PDFPrivacyQAWeb)check(requests.every(e=>new URL(e.name).origin===location.origin),'Web uses same-origin assets only');
  else check(!requests.length,'No HTTP requests after loading standalone HTML');
  show('ALL PASSED · '+self.origin);document.body.dataset.privacyQA='passed';
 }catch(e){show('FAIL '+e.stack);document.body.dataset.privacyQA='failed';console.error(e);}
})();
