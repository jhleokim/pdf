import fs from 'node:fs';
import {createHash} from 'node:crypto';

const base=new URL(process.argv[2]||'https://pdf-ocr-lab.hanatrust.workers.dev/');
const local=new URL('../../dist/ppocr-v5-web/',import.meta.url);
for(const name of fs.readdirSync(local).filter(name=>name!=='_headers')){
 const response=await fetch(new URL(name,base),{signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw Error(name+': HTTP '+response.status);
 const actual=new Uint8Array(await response.arrayBuffer());
 const expected=fs.readFileSync(new URL(name,local));
 if(createHash('sha256').update(actual).digest('hex')!==createHash('sha256').update(expected).digest('hex'))throw Error(name+': SHA256 mismatch');
 console.log(name+': HTTP '+response.status+', SHA256 OK');
}
const response=await fetch(base,{method:'HEAD',signal:AbortSignal.timeout(15000)});
if(!response.headers.get('content-security-policy')?.includes("form-action 'none'"))throw Error('Expected CSP missing');
for(const name of ['contract-1.png','visible-results.json','baseline-results.json']){
 const r=await fetch(new URL(name,base),{method:'HEAD',signal:AbortSignal.timeout(15000)});
 if(r.status!==404)throw Error('Private fixture path must return 404: '+name);
}
console.log('CSP present; private fixture paths return 404.');
