const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const standalone=process.argv.includes('--standalone'),name=standalone?'direct-edit-standalone':'direct-edit';
const source=standalone?'dist/PDF-Studio-Standalone-v'+fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()+'.html':'index.html';
const html=fs.readFileSync(path.join(root,source),'utf8').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src blob: data:">');
const setup=fs.readFileSync(path.join(__dirname,'direct-edit-setup.js'),'utf8'),test=fs.readFileSync(path.join(__dirname,'direct-edit-browser.js'),'utf8');
const output='<output id="directChecks" style="position:fixed;left:8px;bottom:4px;z-index:99999;background:white;color:black;white-space:pre-wrap;font:11px monospace">Running</output>';
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
for(const [suffix,code] of [['check',test],['visual','setupDirectDocument().catch(console.error);']]){
 fs.writeFileSync(path.join(__dirname,'fixtures',name+'-'+suffix+'.html'),html.replace('</body>',(suffix==='check'?output:'')+'<script>'+setup+code+'</script></body>'));
 fs.writeFileSync(path.join(__dirname,'fixtures',name+'-'+suffix+'-mobile.html'),'<!doctype html><meta charset="utf-8"><title>390px document editing</title><style>body{margin:0;background:#ddd}iframe{width:390px;height:844px;border:0}</style><iframe src="'+name+'-'+suffix+'.html" title="모바일 편집 화면"></iframe><output id="mobileChecks" style="white-space:pre-wrap"></output><script>addEventListener("message",e=>{if(e.origin===location.origin&&e.data.directReport)document.getElementById("mobileChecks").textContent=e.data.directReport})</script>');
}
