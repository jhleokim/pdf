const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const code=`(async()=>{
const out=document.getElementById('blankChecks'),checks=[],assert=(v,m)=>{if(!v)throw Error(m)},record=m=>{checks.push(m);out.textContent=checks.join('\\n')};
try{
  setProMode('basic');
  assert($('btnBlank').nextElementSibling===$('btnDel')&&$('mbBlank').nextElementSibling===$('mbDel'),'Button order');
  await insertBlankPage();
  assert(pages.length===1&&selected()[0]===pages[0]&&previewUid===pages[0].uid,'New document selection');
  let result=await buildEditedDocument(),size=result.getPage(0).getSize();
  assert(Math.abs(size.width-595.28)<.01&&Math.abs(size.height-841.89)<.01,'A4 size');record('Empty document starts with a selected A4 blank');
  const input=await PDFDocument.create();
  const a=input.addPage([400,600]);a.drawText('ORIGINAL PAGE',{x:40,y:400,size:16});a.setCropBox(20,30,300,500);a.setRotation(degrees(90));a.node.set(PDFLib.PDFName.of('UserUnit'),PDFLib.PDFNumber.of(2));
  input.addPage([450,650]);
  await loadFiles([new File([await input.save()],'Synthetic.pdf',{type:'application/pdf'})]);
  selectNone();select(1,{});const anchor=pages[1];await insertBlankPage();
  assert(pages[1]===anchor&&pages.length===4&&selected()[0]===pages[2],'Insert after selection');
  result=await buildEditedDocument();size=result.getPage(2).getSize();
  assert(size.width===1000&&size.height===600,'Cropped rotated physical size');record('Insertion follows selection and preserves rotated crop size with UserUnit');
  selectNone();pages[0].el.classList.add('selected');pages[3].el.classList.add('selected');await insertBlankPage();
  assert(pages.length===5&&selected()[0]===pages[4],'Multiple selection anchor');record('Multiple selection inserts after the last selected page');
  selectNone();await insertBlankPage();assert(pages.length===6&&selected()[0]===pages[5],'Append');
  rotate(selected(),90);await insertBlankPage();
  result=await buildEditedDocument();size=result.getPage(6).getSize();assert(size.width===650&&size.height===450,'Editor rotation');
  const saved=await result.save(),read=await pdfjsLib.getDocument({data:saved.slice(),...DOC_OPTS}).promise;
  assert(read.numPages===7,'Export count');assert((await(await read.getPage(7)).getTextContent()).items.length===0,'Blank has unexpected text');
  assert((await(await read.getPage(2)).getTextContent()).items.some(x=>x.str.includes('ORIGINAL PAGE')),'Original content changed');await read.destroy();record('Append, rotation and PDF export preserve blank and original content');
  const removePage=selected()[0];remove([removePage]);assert(pages.length===6&&!pages.includes(removePage),'Blank deletion');record('Inserted pages remain editable and deletable');
  if(innerWidth<=880){const r=$('mbBlank').getBoundingClientRect();assert(r.width>=40&&r.height>=44&&r.right<=innerWidth,'Mobile button is clipped');record('Mobile blank action fits beside delete');}
  setProMode('pro');assert(getComputedStyle($('btnBlank')).display==='none','Pro-only visibility');setProMode('basic');
  out.textContent='PASS · '+checks.length+' blank-page checks\\n'+checks.join('\\n');
}catch(e){out.textContent='FAIL · '+e.stack;}finally{if(parent!==window)parent.postMessage({blankReport:out.textContent},location.origin)}
})();`;
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'fixtures/blank-page.html'),html.replace('</body>','<output id="blankChecks" style="position:fixed;left:8px;bottom:4px;z-index:99999;background:white;color:black;white-space:pre-wrap;font:12px monospace">Running</output><script>'+code+'</script></body>'));
fs.writeFileSync(path.join(__dirname,'fixtures/blank-mobile.html'),'<!doctype html><meta charset="utf-8"><title>Blank page mobile check</title><iframe src="blank-page.html" style="width:390px;height:844px;border:0"></iframe><output id="mobileChecks" style="white-space:pre-wrap"></output><script>window.addEventListener("message",e=>{if(e.origin===location.origin&&e.data.blankReport)document.getElementById("mobileChecks").textContent=e.data.blankReport})</script>');
