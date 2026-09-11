import {mkdirSync,copyFileSync,writeFileSync,cpSync} from 'node:fs';
mkdirSync(new URL('../.deploy/',import.meta.url),{recursive:true});
copyFileSync(new URL('../index.html',import.meta.url),new URL('../.deploy/index.html',import.meta.url));
cpSync(new URL('../vendor/paddle/licenses/',import.meta.url),new URL('../.deploy/ocr/paddle/licenses/',import.meta.url),{recursive:true});
writeFileSync(new URL('../.deploy/_headers',import.meta.url),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/ocr/paddle/*
  Cache-Control: public, max-age=31536000, immutable
`);
