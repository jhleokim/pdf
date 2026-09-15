const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
const standalone=fs.readFileSync(path.join(root,`dist/PDF-Studio-Standalone-v${version}.html`),'utf8');
const folder=path.join(__dirname,'fixtures');fs.mkdirSync(folder,{recursive:true});
function fixture(html,name,script,offline){
  if(offline)html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src blob: data:">');
  fs.writeFileSync(path.join(folder,name),html.replace('</body>','<script>'+fs.readFileSync(path.join(__dirname,script),'utf8')+'</script></body>'));
}
fixture(standalone,'arrow-layout.html','arrow-layout-browser.js',true);
fixture(standalone,'privacy-lifecycle.html','privacy-lifecycle-browser.js',true);
fixture(fs.readFileSync(path.join(root,'index.html'),'utf8').replaceAll('"/privacy/','"/.deploy/privacy/'),'privacy-lifecycle-web.html','privacy-lifecycle-browser.js',false);
fs.writeFileSync(path.join(folder,'arrow-mobile.html'),'<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0}iframe{width:390px;height:844px;border:0}pre{white-space:pre-wrap}</style><iframe src="arrow-layout.html"></iframe><pre id="report"></pre><script>onmessage=e=>{if(e.origin===location.origin&&e.data.arrowReport)document.getElementById("report").textContent=e.data.arrowReport;};</script>');
console.log('Created local-only v6.1.1 lifecycle and layout fixtures.');
