const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/ocr-scan.pdf')).toString('base64');
const code=fs.readFileSync(path.join(__dirname,'tools-ui-browser.js'),'utf8');
html=html.replace('</body>',`<aside id="toolsTest" style="position:fixed;left:6px;top:6px;width:330px;max-height:140px;overflow:auto;background:white;color:black;border:1px solid #aaa;z-index:20000;padding:8px;font:12px system-ui"><b>Pro UI checks</b><pre id="toolsTestResult" style="white-space:pre-wrap">Running</pre></aside><script>const TEST_SCAN='${fixture}';\n${code}</script></body>`);
fs.writeFileSync(path.join(__dirname,'fixtures/tools-ui-check.html'),html);
console.log('Generated tools-ui-check.html with synthetic document only.');
