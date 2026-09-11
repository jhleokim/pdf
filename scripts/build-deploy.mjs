import {tesseractWebAssets} from './build.mjs';
import {mkdirSync,copyFileSync,writeFileSync,cpSync} from 'node:fs';
mkdirSync(new URL('../.deploy/',import.meta.url),{recursive:true});
copyFileSync(new URL('../index.html',import.meta.url),new URL('../.deploy/index.html',import.meta.url));
cpSync(new URL('../vendor/paddle/licenses/',import.meta.url),new URL('../.deploy/ocr/paddle/licenses/',import.meta.url),{recursive:true});
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
/ocr/paddle/*
  Cache-Control: public, max-age=31536000, immutable
`);
