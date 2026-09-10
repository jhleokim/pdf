(async()=>{
 const out=$('fullPreviewChecks'),checks=[],assert=(v,m)=>{if(!v)throw Error(m)},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const record=m=>{checks.push(m);out.textContent=checks.join('\n')};
 const sample=(c,a)=>{const x=Math.floor(a.nx*c.width),y=Math.floor(a.ny*c.height),w=Math.min(c.width-x,Math.ceil(a.nw*c.width)),h=Math.min(c.height-y,Math.ceil(a.nh*c.height));return c.getContext('2d').getImageData(x,y,w,h).data};
 const ink=(c,a)=>{const data=sample(c,a);let n=0;for(let i=0;i<data.length;i+=4)if(data[i]<180&&data[i+1]<180&&data[i+2]<180)n++;return n};
 let first,plain,text;
 try{
  setProMode('basic');await insertBlankPage();first=pages[0];if(isMobile())setMobileView('preview');
  await showPreview(first);await openTextEditor({x:.15,y:.3});$('textInput').value='한글 미리보기 ABC 123';const update=queueTextChange({text:$('textInput').value,fontSize:24});text=textEditing.a;
  await preview(first);await update;
  assert(!textEditing&&$('modal').classList.contains('open')&&ink($('modalCanvas'),text)>100,'typed text is missing from full-page preview');
  const saved=await buildEditedDocument([first]),pdf=await pdfjsLib.getDocument({data:await saved.save(),...DOC_OPTS}).promise,content=await (await pdf.getPage(1)).getTextContent();
  assert(content.items.map(x=>x.str).join(' ').includes('한글 미리보기 ABC 123'),'saved text missing');await pdf.destroy();closeFullPreview();record('Pending Korean/English input appears in the full preview and searchable saved PDF');
  await openTextEditor(null,text);$('textInput').value='바뀐 내용';await queueTextChange({text:$('textInput').value,color:'#cc0000'});await preview(first);
  let red=0;const data=sample($('modalCanvas'),text);for(let i=0;i<data.length;i+=4)if(data[i]>data[i+1]+50)red++;
  assert(red>50&&text.text==='바뀐 내용','reopened preview shows stale text or color');closeFullPreview();record('Reopening reflects edited text and color');
  const mark={id:'preview-highlight',shape:'highlight',nx:.1,ny:.52,nw:.7,nh:.035,fill:'#ffe082',opacity:.4,lineWidth:0,stroke:'none'};
  const shape={id:'preview-shape',shape:'rect',nx:.1,ny:.62,nw:.2,nh:.1,fill:'#008c82',opacity:1,lineWidth:2,stroke:'#008c82'};
  const stampCanvas=document.createElement('canvas');stampCanvas.width=stampCanvas.height=8;stampCanvas.getContext('2d').fillStyle='#2233cc';stampCanvas.getContext('2d').fillRect(0,0,8,8);
  const url=stampCanvas.toDataURL('image/png');stamps.set('preview-image',{mime:'image/png',bytes:b64bytes(url.split(',')[1]),url,ratio:1});
  const picture={id:'preview-picture',shape:'image',stamp:'preview-image',nx:.5,ny:.62,nw:.2,nh:.1,opacity:1};first.annots.push(mark,shape,picture);await preview(first);
  const h=sample($('modalCanvas'),mark),s=sample($('modalCanvas'),shape),im=sample($('modalCanvas'),picture);let yellow=0,green=0,blue=0;
  for(let i=0;i<h.length;i+=4)if(h[i]>h[i+2]+20)yellow++;
  for(let i=0;i<s.length;i+=4)if(s[i+1]>s[i]+50)green++;
  for(let i=0;i<im.length;i+=4)if(im[i+2]>im[i]+80)blue++;
  assert(yellow>100&&green>100&&blue>100,'non-text markup missing: '+[yellow,green,blue]);closeFullPreview();record('Highlights, shapes and images are included alongside text');
  for(const rotation of [90,180,270]){
   const doc=await PDFDocument.create(),pg=doc.addPage([400,600]);pg.setCropBox(20,30,300,500);pg.setRotation(degrees(rotation));pg.node.set(PDFLib.PDFName.of('UserUnit'),PDFLib.PDFNumber.of(2));
   await loadFiles([new File([await doc.save()],'Rotated preview '+rotation+'.pdf',{type:'application/pdf'})]);const p=pages.at(-1);await showPreview(p);await openTextEditor({x:.15,y:.25});$('textInput').value='회전 검토 ABC';await queueTextChange({text:$('textInput').value,color:'#222222',fontSize:24});const a=textEditing.a;
   await preview(p);const c=$('modalCanvas');assert(ink(c,a)>40,'rotated text missing '+rotation);assert(c.clientWidth<=innerWidth-40&&c.clientHeight<=innerHeight-60,'rotated preview is not fitted');closeFullPreview();
  }record('Text remains visible and fitted at 90/180/270 degrees with CropBox and UserUnit=2');
  await insertBlankPage({beforeUid:null});plain=pages.at(-1);await preview(plain);const original=docs.get(plain.docId).pdfjsDoc;closeFullPreview();assert((await original.getPage(1)).view.length===4,'closing destroyed the source');record('Unedited preview closes without destroying the source PDF');
  await Promise.all([preview(first),preview(plain)]);assert($('modal').classList.contains('open')&&ink($('modalCanvas'),{nx:0,ny:0,nw:1,nh:1})===0,'older preview replaced the latest page');closeFullPreview();record('Rapid opens publish only the most recently requested page');
  const build=buildEditedDocument;let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  buildEditedDocument=async(...args)=>{entered();await gate;return build(...args)};
  try{const pending=preview(first);await started;closeFullPreview();release();await pending;assert(!$('modal').classList.contains('open')&&$('modalCanvas').width===0&&!modalRenderTask,'closed preview reopened or retained its canvas')}finally{buildEditedDocument=build}
  record('Closing during preparation cancels publication and releases temporary rendering resources');
  buildEditedDocument=async()=>{throw Error('Deliberate preview test failure')};
  try{await preview(first);assert(!$('modalStatus').hidden&&$('modalStatus').textContent.includes('열지 못했습니다')&&$('modalCanvas').style.display==='none','failed preparation displays an old unedited page')}finally{buildEditedDocument=build;closeFullPreview()}
  await preview(first);assert($('modalStatus').hidden&&$('modalCanvas').width>0,'preview cannot recover');closeFullPreview();record('A preparation error hides stale content and can be retried');
  await showPreview(first);$('proOptimize').checked=false;setProMode('pro');
  for(let i=0;i<400&&$('proCompare').getAttribute('aria-busy')==='true';i++)await wait(30);
  assert(!$('proCompare').hasAttribute('data-error')&&$('compareAfter').width>0,'Pro preview failed');
  const proPixels=sample($('compareAfter'),text);let proRed=0;for(let i=0;i<proPixels.length;i+=4)if(proPixels[i]>proPixels[i+1]+50)proRed++;
  assert(proRed>10,'Pro preview is missing Basic text');setProMode('basic');record('The same text is retained in the Pro full-page result preview');
  const network=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name)&&new URL(e.name).origin!==location.origin);assert(!network.length,'external network dependency');
  await showPreview(first);await preview(first);out.textContent='PASS · '+checks.length+' full-preview checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e)}finally{if(parent!==window)parent.postMessage({fullPreviewReport:out.textContent},location.origin)}
})();
