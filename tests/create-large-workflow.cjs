const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="connect-src 'self' blob: data:">`);
const code=fs.readFileSync(path.join(__dirname,'large-workflow-browser.js'),'utf8');
const suffix=process.argv.includes('--baseline')?'-baseline':'';
fs.writeFileSync(path.join(__dirname,'fixtures/large-workflow'+suffix+'.html'),html.replace('</body>','<script>'+code+'</script></body>'));
