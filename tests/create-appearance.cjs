const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim(),folder=path.join(__dirname,'fixtures');fs.mkdirSync(folder,{recursive:true});
for(const standalone of[false,true]){
 let html=fs.readFileSync(path.join(root,standalone?`dist/PDF-Studio-Standalone-v${version}.html`:'index.html'),'utf8');
 // Block network access after navigation; embedded assets still run in the offline build.
 html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src blob: data:">');
 const name=`appearance${standalone?'-standalone':''}.html`;
 fs.writeFileSync(path.join(folder,name),html.replace('</body>','<script>'+fs.readFileSync(path.join(__dirname,'appearance-browser.js'),'utf8')+'</script></body>'));
}
fs.writeFileSync(path.join(folder,'appearance-mobile.html'),'<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0}iframe{width:390px;height:844px;border:0}pre{white-space:pre-wrap}</style><iframe src="appearance-standalone.html"></iframe><pre id="report"></pre><script>onmessage=e=>{if(e.origin===location.origin&&e.data.appearanceReport)document.getElementById("report").textContent=e.data.appearanceReport;};</script>');
