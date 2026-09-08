import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

// The hosted build keeps optional cloud OCR. The downloadable artifact does not
// contain its controls, unlock handler, or network client, even when HTTP-hosted.
export function standaloneHTML(webHTML){
  let html=webHTML;
  const remove=(pattern,label)=>{
    const matches=[...html.matchAll(new RegExp(pattern.source,'g'))];
    if(matches.length!==1)throw new Error(`Expected one ${label}; check standalone build against web changes`);
    html=html.replace(pattern,'');
  };
  remove(/<script id="pro-gemini">[\s\S]*?<\/script>\s*/,'Gemini network module');
  remove(/<div id="geminiTools"[^>]*>[\s\S]*?<\/div>\s*/,'Gemini controls');
  remove(/<dialog id="geminiDialog"[^>]*>[\s\S]*?<\/dialog>\s*/,'Gemini consent dialog');
  remove(/let geminiClicks=0,[\s\S]*?(?=syncToolsState\(\);\s*<\/script>)/,'Gemini unlock and consent handlers');
  // The shared OCR renderer also supports cloud results in the web build. Only
  // the local provider is callable here; optional controls must not be accessed.
  const buttons="['ocrSample','ocrRun','geminiRun']";
  if(html.split(buttons).length!==3)throw new Error('OCR button bindings changed');
  html=html.replaceAll(buttons,"['ocrSample','ocrRun']");
  const entry="async function runOCR(sample,provider='tesseract',confirmedList=null,consent=false){";
  if(html.split(entry).length!==2)throw new Error('OCR entry point changed');
  html=html.replace(entry,entry+"\n  if(provider!=='tesseract')return;");
  if(/id="(?:pro-gemini|geminiTools|geminiDialog)"|\/api\/ocr\/gemini|generativelanguage\.googleapis\.com|geminiClicks/.test(html))throw new Error('Cloud OCR leaked into standalone');
  return html;
}

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const version=readFileSync(resolve(root,'VERSION'),'utf8').trim();
  if(!/^\d+\.\d+(?:\.\d+)?$/.test(version))throw new Error('Invalid VERSION');
  const html=standaloneHTML(readFileSync(resolve(root,'index.html'),'utf8'));
  mkdirSync(resolve(root,'dist'),{recursive:true});
  const output=resolve(root,'dist',`PDF-Studio-Standalone-v${version}.html`);
  writeFileSync(output,html);
  console.log(`Built ${output}; local Tesseract OCR only.`);
}
