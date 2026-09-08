const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const standalone=process.argv.includes('--standalone');
const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
let html=fs.readFileSync(path.join(root,standalone?`dist/PDF-Studio-Standalone-v${version}.html`:'index.html'),'utf8');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/ocr-scan.pdf')).toString('base64');
const code=fs.readFileSync(path.join(__dirname,'tools-ui-browser.js'),'utf8');
if(standalone){
  html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src data: blob:">');
  html=html.replace('</body>',`<script>for(let i=0;i<12;i++)document.getElementById('modePro').click();if(document.getElementById('geminiTools')||document.getElementById('geminiDialog')||typeof PDFGemini!=='undefined')throw new Error('Standalone cloud entry point remains');</script></body>`);
}
html=html.replace('</body>',`<aside id="toolsTest" style="position:fixed;left:6px;top:6px;width:330px;max-height:140px;overflow:auto;background:white;color:black;border:1px solid #aaa;z-index:20000;padding:8px;font:12px system-ui"><b>Pro UI checks</b><pre id="toolsTestResult" style="white-space:pre-wrap">Running</pre></aside><script>const TEST_SCAN='${fixture}';\n${code}</script></body>`);
const output=standalone?'standalone-ui-check.html':'tools-ui-check.html';
fs.writeFileSync(path.join(__dirname,'fixtures',output),html);
console.log(`Generated ${output} with synthetic document only.`);
