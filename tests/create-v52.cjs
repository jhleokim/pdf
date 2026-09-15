const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const source=process.argv[2]||'index.html',output=process.argv[3]||'v52-check.html';
const html=fs.readFileSync(path.join(root,source),'utf8').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src blob: data:">');
const script=fs.readFileSync(path.join(__dirname,'v52-browser.js'),'utf8').replace('const results=[]','const P=PDFLib; const results=[]');
fs.writeFileSync(path.join(root,output),html.replace('</body>','<script>'+script+'</script></body>'));
console.log('Created '+output);
