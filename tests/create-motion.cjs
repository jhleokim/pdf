const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const standalone=process.argv.includes('--standalone'),name=standalone?'motion-standalone':'motion';
const source=standalone?'dist/PDF-Studio-Standalone-v'+fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()+'.html':'index.html';
const html=fs.readFileSync(path.join(root,source),'utf8').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src blob: data:">');
const setup=`async function setupMotionDocument(){
 setProMode('basic');const pdf=await PDFDocument.create();
 for(let i=0;i<8;i++){const p=pdf.addPage([595,842]);p.drawText('Animation review — page '+(i+1),{x:54,y:744,size:24});p.drawRectangle({x:54,y:550,width:487,height:100,color:rgb(.9,.95,.94)});}
 await loadFiles([new File([await pdf.save()],'Motion review.pdf',{type:'application/pdf'})]);
 setMobileView('board');await showPreview(pages[0]);
}`;
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
for(const visual of [false,true]){
 const filename=name+(visual?'-visual':'-check')+'.html';
 const output=visual?'':'<output id="motionChecks" style="position:fixed;left:8px;bottom:4px;z-index:99999;background:white;color:black;white-space:pre-wrap;font:11px monospace">Running</output>';
 const code=visual?`setupMotionDocument().catch(console.error);
 const trace=document.createElement('output');trace.id='gestureTrace';trace.style='position:fixed;bottom:38px;left:8px;z-index:99999;background:white;color:black;font:11px monospace;pointer-events:none';document.body.appendChild(trace);
 const events=[];for(const type of ['pointerdown','dragstart','dragover','drop','dragend','pointerup','pointercancel'])document.addEventListener(type,e=>{const detail=type+' '+e.clientX+','+e.clientY+' '+e.target.nodeName+' before '+(marker.nextElementSibling?.dataset.uid||'end');events.push(detail);trace.textContent=events.slice(-5).join(' | ')},false);`:fs.readFileSync(path.join(__dirname,'motion-browser.js'),'utf8');
 fs.writeFileSync(path.join(__dirname,'fixtures',filename),html.replace('</body>',output+'<script>'+setup+code+'</script></body>'));
 fs.writeFileSync(path.join(__dirname,'fixtures',filename.replace('.html','-mobile.html')),'<!doctype html><meta charset="utf-8"><title>Mobile motion review</title><style>body{margin:0}iframe{width:390px;height:844px;border:0}</style><iframe src="'+filename+'" title="모바일 동작 점검"></iframe><output id="mobileChecks" style="white-space:pre-wrap"></output><script>addEventListener("message",e=>{if(e.origin===location.origin&&e.data.motionReport)document.getElementById("mobileChecks").textContent=e.data.motionReport})</script>');
}
