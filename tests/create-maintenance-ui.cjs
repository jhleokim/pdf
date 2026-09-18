const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="connect-src 'self' blob: data:">`);
const code=fs.readFileSync(path.join(__dirname,'maintenance-ui-browser.js'),'utf8');
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'fixtures/maintenance-ui.html'),html.replace('</body>','<script>'+code+'</script></body>'));
fs.writeFileSync(path.join(__dirname,'fixtures/maintenance-ui-mobile.html'),'<!doctype html><meta charset="utf-8"><iframe title="모바일 유지보수 검사" src="maintenance-ui.html" style="width:390px;height:844px;border:0"></iframe><pre id="mobileChecks"></pre><script>onmessage=e=>{if(e.source===document.querySelector("iframe").contentWindow&&e.data.maintenanceReport)document.getElementById("mobileChecks").textContent=e.data.maintenanceReport}</script>');
