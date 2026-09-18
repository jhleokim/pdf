import {tesseractWebAssets,markupWebAssets} from './build.mjs';
import {mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {finalizeDeploy} from './finalize-deploy.mjs';
mkdirSync(new URL('../.deploy/',import.meta.url),{recursive:true});
copyFileSync(new URL('../index.html',import.meta.url),new URL('../.deploy/index.html',import.meta.url));
const deployRoot=resolve(fileURLToPath(new URL('../.deploy/',import.meta.url)));
mkdirSync(new URL('../.deploy/ocr/tesseract/7.0.0/',import.meta.url),{recursive:true});
for(const asset of Object.values(tesseractWebAssets))copyFileSync(new URL('../vendor/ocr/'+asset.file,import.meta.url),new URL('../.deploy'+asset.url,import.meta.url));
mkdirSync(new URL('../.deploy/markup/',import.meta.url),{recursive:true});
for(const asset of Object.values(markupWebAssets))copyFileSync(new URL('../vendor/markup/'+asset.file,import.meta.url),new URL('../.deploy'+asset.url,import.meta.url));
writeFileSync(new URL('../.deploy/_headers',import.meta.url),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/ocr/tesseract/*
  Cache-Control: public, max-age=31536000, immutable
/ocr/ppocr-v5/*
  Cache-Control: public, max-age=31536000, immutable
/ocr/ppocr-v5/manifest.json
  Cache-Control: no-cache
/privacy/*
  Cache-Control: public, max-age=31536000, immutable
/markup/*
  Cache-Control: public, max-age=31536000, immutable
`);
// A reused output folder must never publish old QA pages or unrelated files.
// Read the privacy manifest from the shipped HTML: importing build.mjs may have
// produced a newer worker when this command follows an independent source edit.
const html=readFileSync(resolve(deployRoot,'index.html'),'utf8');
const privacyMatch=html.match(/globalThis\.PDFPrivacyAssets=(\{[^\r\n<]+\})<\/script>/);
if(!privacyMatch)throw Error('Missing privacy deployment manifest');
const privacy=JSON.parse(privacyMatch[1]);
const paddle=JSON.parse(readFileSync(resolve(deployRoot,'ocr/ppocr-v5/manifest.json'),'utf8'));
if(!html.includes('const runtimeURL='+JSON.stringify(paddle.runtimeURL)+';'))throw Error('Stale Paddle deployment manifest: rebuild the web HTML first');
const webAsset=asset=>{
  if(typeof asset.url!=='string'||!/^\/(?:ocr\/tesseract\/|markup\/|privacy\/)/.test(asset.url))throw Error('Invalid deployment asset URL');
  return {file:asset.url.slice(1),bytes:asset.bytes,sha256:asset.sha256};
};
const files=[{file:'index.html'},{file:'_headers'},{file:'ocr/ppocr-v5/manifest.json'},
  ...Object.values(tesseractWebAssets).map(webAsset),...Object.values(markupWebAssets).map(webAsset),...Object.values(privacy).map(webAsset),
  ...Object.values(paddle.assets).map(asset=>({...asset,file:'ocr/ppocr-v5/'+asset.file})),
  ...['LICENSE-PaddleOCR.txt','LICENSE-OpenCV.txt','LICENSE-ONNXRuntime.txt','ONNXRuntime-ThirdPartyNotices.txt'].map(file=>({file:'ocr/ppocr-v5/'+file}))];
const removed=finalizeDeploy(deployRoot,files);
console.log('Verified deployment assets; removed '+removed.length+' unrelated generated files; retained valid historical assets for open sessions.');
