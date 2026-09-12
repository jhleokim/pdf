import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {buildHTML} from './build.mjs';
import {buildPPOCRV5Assets} from './build-ppocr-v5.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const version=readFileSync(resolve(root,'VERSION'),'utf8').trim();
  if(!/^\d+\.\d+(?:\.\d+)?$/.test(version))throw new Error('Invalid VERSION');
  await buildPPOCRV5Assets();
  const html=buildHTML({standalone:true});
  mkdirSync(resolve(root,'dist'),{recursive:true});
  const output=resolve(root,'dist',`PDF-Studio-Standalone-v${version}.html`);
  writeFileSync(output,html);
  console.log(`Built ${output}; local Tesseract + PP-OCRv5 and OCR correction included.`);
}
