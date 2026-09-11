import fs from 'node:fs';import {createHash} from 'node:crypto';import YAML from 'yaml';
const root=new URL('../../',import.meta.url),directory=new URL('work/ppocr-v5-models/',root);fs.mkdirSync(directory,{recursive:true});
for(const item of JSON.parse(fs.readFileSync(new URL('models.json',import.meta.url)))){
 const target=new URL(item.file,directory);let bytes=fs.existsSync(target)?fs.readFileSync(target):null;
 const valid=b=>b?.length===item.bytes&&createHash('sha256').update(b).digest('hex')===item.sha256;
 if(!valid(bytes)){const response=await fetch(item.source,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Download failed '+item.file);bytes=Buffer.from(await response.arrayBuffer());if(!valid(bytes))throw Error('Integrity mismatch '+item.file);fs.writeFileSync(target,bytes);}
}
const config=YAML.parse(fs.readFileSync(new URL('rec.yml',directory),'utf8'));
fs.writeFileSync(new URL('dict.json',directory),JSON.stringify(['blank',...config.PostProcess.character_dict,' ']));console.log('Pinned official models and Korean dictionary ready.');
