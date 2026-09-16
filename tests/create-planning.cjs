const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..'),version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
const dir=path.join(root,'work/planning-qa');fs.mkdirSync(dir,{recursive:true});
for(const offline of [false,true]){
 let html=fs.readFileSync(path.join(root,offline?`dist/PDF-Studio-Standalone-v${version}.html`:'index.html'),'utf8');
 html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src '+(offline?'blob: data:':"'self' blob: data:")+'">');
 html=html.replace('</body>','<script>self.PLANNING_OFFLINE='+offline+';'+fs.readFileSync(path.join(__dirname,'planning-browser.js'),'utf8')+'</script></body>');
 fs.writeFileSync(path.join(dir,offline?'offline.html':'web.html'),html);
}
fs.writeFileSync(path.join(dir,'opaque.html'),'<meta charset="utf-8"><h1>Standalone offline integration</h1><pre id="result">Loading…</pre><iframe sandbox="allow-scripts allow-modals allow-downloads" src="offline.html" style="width:1360px;height:900px"></iframe><script>onmessage=e=>{if(e.source===document.querySelector("iframe").contentWindow&&e.data.planningQA)document.getElementById("result").textContent=e.data.planningQA}</script>');
fs.writeFileSync(path.join(dir,'layout-app.html'),fs.readFileSync(path.join(root,'index.html'),'utf8').replace('</body>','<script>'+fs.readFileSync(path.join(__dirname,'planning-layout-browser.js'),'utf8')+'</script></body>'));
for(const [w,h]of [[390,844],[620,900],[621,900],[768,1024],[844,390]])fs.writeFileSync(path.join(dir,`layout-${w}.html`),`<meta charset="utf-8"><h1>Responsive ${w} × ${h}</h1><pre id="result">Loading…</pre><iframe src="layout-app.html" style="width:${w}px;height:${h}px;border:0"></iframe><script>onmessage=e=>{if(e.source===document.querySelector('iframe').contentWindow&&e.data.layoutQA)document.getElementById('result').textContent=e.data.layoutQA}</script>`);
