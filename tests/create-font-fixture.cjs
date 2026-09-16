const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..'),version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
for(const standalone of [false,true]){
 const input=path.join(root,standalone?`dist/PDF-Studio-Standalone-v${version}.html`:'index.html');
 const html=fs.readFileSync(input,'utf8').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src '+(standalone?'blob: data:':"'self' blob: data:")+'">');
 fs.writeFileSync(path.join(__dirname,'fixtures',standalone?'font-standalone.html':'font-web.html'),html.replace('</body>','<pre id="fontChecks" style="position:fixed;bottom:0;left:4px;z-index:99999;background:white;color:black;font:12px monospace">Running</pre><script>'+fs.readFileSync(path.join(__dirname,'font-browser.js'),'utf8')+'</script></body>'));
}
