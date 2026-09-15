(async()=>{
 const out=$('fontChecks'),checks=[],assert=(v,m)=>{if(!v)throw Error(m)},record=m=>{checks.push(m);out.textContent=checks.join('\n')};
 try{
  setProMode('basic');await insertBlankPage();const target=pages[0];await setEditingFocus(true);
  const options=[...$('textFont').options].map(o=>o.value);assert(options.join(',')==='gothic,myeongjo,hana-regular,hana-bold','Font choices are missing or reordered');
  record('Both Nanum and both Hana fonts are available in the text toolbar');
  const samples=[];
  for(const family of options){
   await openTextEditor({x:.08,y:.1+samples.length*.14});$('textInput').value='공동명의 계약금 123,450원 ABC';
   $('textFont').value=family;$('textFont').dispatchEvent(new Event('change',{bubbles:true}));
   await textUpdate;await queueTextChange({text:$('textInput').value,font:family,fontSize:18});
   const a=textEditing.a;assert(a.font===family,'Font selection did not reach draft');
   assert(getComputedStyle($('textInput')).fontFamily.includes(PDFMarkupText.families[family].family),'Draft uses a fallback font');
   samples.push(a);await applyTextEditor();assert(document.fonts.check('18px '+PDFMarkupText.families[family].family),'Browser font is not loaded');
   record(family+' renders in the editor and commits without losing Korean text');
  }
  const doc=await buildEditedDocument([target]);
  await PDFOCR.apply(doc,[{uid:target.uid,source:'vision',words:[{text:'검색용 공동명의 OCR',box:[.08,.85,.5,.9]}]}],{pageIds:[target.uid]});
  const bytes=await doc.save(),pdf=await pdfjsLib.getDocument({data:bytes.slice(),...DOC_OPTS}).promise;
  try{
   const page=await pdf.getPage(1),text=(await page.getTextContent()).items.map(i=>i.str).join(' ');
   assert((text.match(/공동명의 계약금/g)||[]).length===4&&text.includes('검색용 공동명의 OCR'),'Searchable text is missing');
   const canvas=document.createElement('canvas'),vp=page.getViewport({scale:1.4});canvas.width=vp.width;canvas.height=vp.height;
   await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
   for(const a of samples){const pixels=canvas.getContext('2d').getImageData(Math.floor(a.nx*canvas.width),Math.floor(a.ny*canvas.height),Math.ceil(a.nw*canvas.width),Math.ceil(a.nh*canvas.height)).data;let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<150)ink++;assert(ink>150,a.font+' disappeared in PDF export');}
  }finally{await pdf.destroy();}
  record('Export renders all four fonts and retains visible text plus the invisible OCR layer');
  const form=document.createElement('a');form.href=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));form.download='PDF-Studio-v6.2.2-font-check.pdf';form.textContent='Download verified font PDF';form.id='fontDownload';out.after(form);
  await preview(target);assert($('modalCanvas').width>0,'Full preview failed');closeFullPreview();
  record('The full-page preview still renders the edited document');
  const external=performance.getEntriesByType('resource').filter(e=>/^https?:/.test(e.name)&&new URL(e.name).origin!==location.origin);assert(!external.length,'External font request');
  record('Fonts work with HTTP connections blocked');out.textContent='PASS · '+checks.length+' font checks\n'+checks.join('\n');
 }catch(e){out.textContent='FAIL · '+e.stack;console.error(e);}
})();
