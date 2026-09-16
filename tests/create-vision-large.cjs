const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\' blob: data:">');
html=html.replace('</body>','<script>'+fs.readFileSync(path.join(__dirname,'vision-large-browser.js'),'utf8')+'</script></body>');
fs.mkdirSync(path.join(root,'tests/fixtures'),{recursive:true});
fs.writeFileSync(path.join(root,'tests/fixtures/vision-large.html'),html);
console.log('Created local-only 212-page Vision workflow fixture; serve a PDF at /qa/book.pdf');
