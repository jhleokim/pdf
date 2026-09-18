const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="connect-src 'self' blob: data:">`);
const code=fs.readFileSync(path.join(__dirname,'page-context-browser.js'),'utf8');
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'fixtures/page-context.html'),html.replace('</body>','<script>'+code+'</script></body>'));
fs.writeFileSync(path.join(__dirname,'fixtures/page-context-mobile.html'),'<!doctype html><meta charset="utf-8"><title>Page context mobile tests</title><iframe src="page-context.html" style="width:390px;height:844px;border:0" title="390px mobile"></iframe><pre id="mobileChecks">Running</pre><script>onmessage=e=>{if(e.source===document.querySelector("iframe").contentWindow&&e.data.pageContextReport)document.getElementById("mobileChecks").textContent=e.data.pageContextReport}</script>');
