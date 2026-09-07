// Generates a local browser regression page using the actual bundled libraries.
// Run node tests/create-pro-browser.cjs, serve the repository, and open
// /tests/fixtures/pro-check.html. No personal documents or external services.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const markers=['sourceMappingURL=pdf-lib.min.js.map','pdfjs-dist/build/pdf"]','pdfjs-dist/build/pdf.worker'];
const library=markers.map(m=>scripts.find(s=>s.includes(m)));
if(library.some(s=>!s))throw Error('Bundled libraries missing');
const testCode=fs.readFileSync(path.join(__dirname,'pro-browser.js'),'utf8');
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'fixtures/pro-check.html'),`<!doctype html><meta charset="utf-8"><title>Pro behavior checks</title><style>body{font:14px system-ui;margin:24px;background:#eee}canvas{max-width:300px;max-height:420px;border:1px solid #ccc;margin:8px}pre{white-space:pre-wrap}a{display:block;margin:8px}</style><h1>Pro behavior checks</h1><pre id="result">Running…</pre><div id="artifacts"></div>${library.map(s=>'<script>'+s+'</script>').join('')}<script src="../../src/pro-engine.js?v=${Date.now()}"></script><script src="../../src/pro-document.js"></script><script src="../../src/pro-deskew.js?v=${Date.now()}"></script><script>${testCode}</script>`);
console.log('Generated tests/fixtures/pro-check.html');
