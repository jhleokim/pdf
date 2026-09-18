const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const offline=process.argv.includes('--standalone'),name=offline?'selected-save-standalone':'selected-save';
const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
const input=offline?'dist/PDF-Studio-Standalone-v'+version+'.html':'index.html';
const html=fs.readFileSync(path.join(root,input),'utf8').replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="connect-src ${offline?'':"'self' "}blob: data:">`);
const code=fs.readFileSync(path.join(__dirname,'selected-save-browser.js'),'utf8');
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'fixtures',name+'.html'),html.replace('</body>','<script>'+code+'</script></body>'));
fs.writeFileSync(path.join(__dirname,'fixtures',name+'-mobile.html'),'<!doctype html><meta charset="utf-8"><title>Selected PDF save mobile checks</title><iframe src="'+name+'.html" style="width:390px;height:844px;border:0" title="390px mobile"></iframe><pre id="mobileChecks">Running</pre><script>onmessage=e=>{if(e.source===document.querySelector("iframe").contentWindow&&e.data.selectedSaveReport)document.getElementById("mobileChecks").textContent=e.data.selectedSaveReport}</script>');
