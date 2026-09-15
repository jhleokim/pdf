const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
// This fixture stays outside .deploy. Local web assets are served by the repo server.
const source=process.argv[2]||'index.html',output=process.argv[3]||'v52-search-check.html';
let html=fs.readFileSync(path.join(root,source),'utf8').replaceAll('"/ocr/','"/.deploy/ocr/').replaceAll("'/ocr/","'/.deploy/ocr/");
if(source.startsWith('dist/'))html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src blob: data:">');
const script=fs.readFileSync(path.join(__dirname,'privacy-search-browser.js'),'utf8');
fs.writeFileSync(path.join(root,output),html.replace('</body>','<script>'+script+'</script></body>'));
console.log('Created '+output);
