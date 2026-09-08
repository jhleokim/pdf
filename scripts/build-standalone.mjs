import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {buildHTML} from './build.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const version=readFileSync(resolve(root,'VERSION'),'utf8').trim();
  if(!/^\d+\.\d+(?:\.\d+)?$/.test(version))throw new Error('Invalid VERSION');
  const html=buildHTML({standalone:true});
  mkdirSync(resolve(root,'dist'),{recursive:true});
  const output=resolve(root,'dist',`PDF-Studio-Standalone-v${version}.html`);
  writeFileSync(output,html);
  console.log(`Built ${output}; local Tesseract OCR only.`);
}
