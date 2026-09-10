const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const offline=process.argv.includes('--standalone'),name=offline?'text-style-standalone':'text-style';
const input=offline?'dist/PDF-Studio-Standalone-v'+fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()+'.html':'index.html';
const html=fs.readFileSync(path.join(root,input),'utf8').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src blob: data:">');
const code=fs.readFileSync(path.join(__dirname,'text-style-browser.js'),'utf8');
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'fixtures',name+'.html'),html.replace('</body>','<output id="textStyleChecks" style="position:fixed;left:8px;bottom:4px;z-index:99999;background:white;color:black;white-space:pre-wrap;font:11px monospace">Running</output><script>'+code+'</script></body>'));
for(const width of [320,390])fs.writeFileSync(path.join(__dirname,'fixtures',name+'-'+width+'.html'),'<!doctype html><meta charset="utf-8"><title>Text style '+width+'px</title><iframe src="'+name+'.html" style="width:'+width+'px;height:844px;border:0" title="Mobile editor"></iframe><output id="mobileChecks" style="white-space:pre-wrap"></output><script>window.addEventListener("message",e=>{if(e.origin===location.origin&&e.data.textStyleReport)document.getElementById("mobileChecks").textContent=e.data.textStyleReport})</script>');
