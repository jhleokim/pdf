const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/ocr-scan.pdf')).toString('base64'),code=fs.readFileSync(path.join(__dirname,'ocr-ui-browser.js'),'utf8');
html=html.replace('</body>',`<pre id="ocrUITest" style="position:fixed;left:8px;top:8px;z-index:99999;background:white;color:black;padding:12px;max-width:500px;white-space:pre-wrap">Running</pre><script>const TEST_SCAN='${fixture}';\n${code}</script></body>`);
fs.writeFileSync(path.join(__dirname,'fixtures/ocr-ui-check.html'),html);
