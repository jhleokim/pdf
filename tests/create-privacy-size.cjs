const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const input=process.argv[2];if(!input)throw Error('Provide a local test PDF path; it is never committed or uploaded.');
const source=process.argv[3]||'index.html',output=process.argv[4]||'tests/fixtures/privacy-size.html';
const html=fs.readFileSync(path.join(root,source),'utf8').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src blob: data:">');
const script=fs.readFileSync(path.join(__dirname,'privacy-size-browser.js'),'utf8').replace('TEST_PDF_BASE64',fs.readFileSync(input).toString('base64'));
fs.mkdirSync(path.dirname(path.join(root,output)),{recursive:true});fs.writeFileSync(path.join(root,output),html.replace('</body>','<script>'+script+'</script></body>'));console.log('Created local-only size fixture: '+output);
