const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const standalone=process.argv.includes('--standalone'),name=standalone?'full-preview-standalone':'full-preview';
const source=standalone?'dist/PDF-Studio-Standalone-v'+fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()+'.html':'index.html';
const html=fs.readFileSync(path.join(root,source),'utf8').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src blob: data:">');
const code=fs.readFileSync(path.join(__dirname,'full-preview-browser.js'),'utf8');
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'fixtures',name+'.html'),html.replace('</body>','<output id="fullPreviewChecks" style="position:fixed;bottom:4px;left:8px;z-index:99999;background:white;color:black;font:11px monospace;white-space:pre-wrap">Running</output><script>'+code+'</script></body>'));
fs.writeFileSync(path.join(__dirname,'fixtures',name+'-mobile.html'),'<!doctype html><meta charset="utf-8"><title>Full page preview mobile</title><style>body{margin:0}iframe{width:390px;height:844px;border:0}</style><iframe src="'+name+'.html" title="모바일 전체 미리보기"></iframe><output id="mobileChecks" style="white-space:pre-wrap"></output><script>addEventListener("message",e=>{if(e.origin===location.origin&&e.data.fullPreviewReport)document.getElementById("mobileChecks").textContent=e.data.fullPreviewReport})</script>');
