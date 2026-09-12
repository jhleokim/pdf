import {tesseractWebAssets} from './build.mjs';
import {mkdirSync,copyFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
mkdirSync(new URL('../.deploy/',import.meta.url),{recursive:true});
copyFileSync(new URL('../index.html',import.meta.url),new URL('../.deploy/index.html',import.meta.url));
// Retire generated VL assets; never remove source/vendor models or document files.
const deployRoot=resolve(fileURLToPath(new URL('../.deploy/',import.meta.url))),retired=resolve(deployRoot,'ocr/paddle');
if(!retired.startsWith(deployRoot+sep)||retired===deployRoot)throw Error('Unsafe generated asset path');
if(existsSync(retired))rmSync(retired,{recursive:true});
mkdirSync(new URL('../.deploy/ocr/tesseract/7.0.0/',import.meta.url),{recursive:true});
for(const asset of Object.values(tesseractWebAssets))copyFileSync(new URL('../vendor/ocr/'+asset.file,import.meta.url),new URL('../.deploy'+asset.url,import.meta.url));
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
`);
