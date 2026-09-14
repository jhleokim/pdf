const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const standalone=process.argv.includes('--standalone'),version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
const html=fs.readFileSync(path.join(root,standalone?`dist/PDF-Studio-Standalone-v${version}.html`:'index.html'),'utf8');
const code=fs.readFileSync(path.join(__dirname,'review-workflow-browser.js'),'utf8');
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'fixtures',`review-workflow${standalone?'-standalone':''}.html`),html.replace('</body>','<output id="reviewWorkflowReport" style="position:fixed;bottom:2px;left:8px;max-width:70%;z-index:99999;background:white;color:black;font:11px monospace;white-space:pre-wrap">Running</output><script>'+code+'</script></body>'));
