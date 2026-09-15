const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..'),dir=path.join(__dirname,'fixtures');
fs.mkdirSync(dir,{recursive:true});const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
for(const standalone of[false,true]){
 let html=fs.readFileSync(path.join(root,standalone?`dist/PDF-Studio-Standalone-v${version}.html`:'index.html'),'utf8');
 html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src blob: data:">');
 fs.writeFileSync(path.join(dir,`pro-defaults${standalone?'-standalone':''}.html`),html.replace('</body>','<script>'+fs.readFileSync(path.join(__dirname,'pro-defaults-browser.js'),'utf8')+'</script></body>'));
}
fs.writeFileSync(path.join(dir,'pro-defaults-mobile.html'),'<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0}iframe{width:390px;height:844px;border:0}pre{white-space:pre-wrap}</style><iframe src="pro-defaults-standalone.html"></iframe><pre id="report"></pre><script>onmessage=e=>{if(e.origin===location.origin&&e.data.proDefaultsReport)document.getElementById("report").textContent=e.data.proDefaultsReport;};</script>');
