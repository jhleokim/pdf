import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,statSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODEL,REVISION,REQUIRED_ASSETS} from './prepare-paddle-assets.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(root,'.deploy/ocr/paddle'),modelDir=resolve(root,'vendor/paddle/assets',REVISION);
const sha=data=>createHash('sha256').update(data).digest('hex');
async function fileHash(path,whole){
  const h=createHash('sha256');
  // Hash each part and its ordered contribution to the full model in one read.
  // No joined model Buffer or second whole-file read is needed.
  for await(const chunk of createReadStream(path)){h.update(chunk);whole?.update(chunk);}
  return h.digest('hex');
}
export async function readyManifest({directory=modelDir,revision=REVISION,requiredAssets=REQUIRED_ASSETS}={}){
  try{
    const manifest=JSON.parse(readFileSync(resolve(directory,'assets.json')));
    if(manifest.schemaVersion!==1||manifest.model!==MODEL||manifest.revision!==revision||!Array.isArray(manifest.assets)||manifest.assets.length!==requiredAssets.length)return null;
    if(!Number.isSafeInteger(manifest.chunkSize)||manifest.chunkSize<1||manifest.chunkSize>25*1024*1024)return null;
    const files=new Set();let total=0;
    for(const expected of requiredAssets){
      const a=manifest.assets.find(a=>a.path===expected.path);
      if(!a||a.size!==expected.size||a.sha256!==expected.sha256||!Array.isArray(a.chunks)||!a.chunks.length||a.chunks.length>64)return null;
      const whole=createHash('sha256');let size=0;
      for(const part of a.chunks){
        if(typeof part.file!=='string'||!/^[a-zA-Z0-9_./-]+$/.test(part.file)||part.file.split('/').some(v=>!v||v==='.'||v==='..')||files.has(part.file)||!Number.isSafeInteger(part.size)||part.size<1||part.size>manifest.chunkSize||!/^[a-f0-9]{64}$/.test(part.sha256))return null;
        const p=resolve(directory,part.file),r=relative(directory,p);
        if(r.startsWith('..')||isAbsolute(r)||statSync(p).size!==part.size)return null;
        if(await fileHash(p,whole)!==part.sha256)return null;
        files.add(part.file);size+=part.size;
      }
      if(size!==a.size||whole.digest('hex')!==expected.sha256)return null;
      total+=size;
    }
    if(total!==manifest.totalSize)return null;
    return manifest;
  }catch{return null;}
}
export async function buildPaddleWeb(){
  let manifest=await readyManifest();
  if(!manifest){
    const {ensurePaddleSources}=await import('./download-paddle-models.mjs');
    const {preparePaddleAssets}=await import('./prepare-paddle-assets.mjs');
    const {sourceDir}=await ensurePaddleSources();
    ({manifest}=await preparePaddleAssets({modelDirectory:sourceDir}));
  }
  mkdirSync(output,{recursive:true});
  const ort=resolve(root,'node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs');
  const transformers=resolve(root,'node_modules/@huggingface/transformers/dist/transformers.web.js');
  const result=await build({entryPoints:[resolve(root,'src/paddle/web-entry.mjs')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline',metafile:true,
    plugins:[{name:'browser-only-ocr',setup(b){b.onResolve({filter:/^onnxruntime-(?:web\/webgpu|common)$/},()=>({path:ort}));b.onResolve({filter:/^@huggingface\/transformers$/},()=>({path:transformers}));}}]});
  if(Object.keys(result.metafile.inputs).some(p=>/onnxruntime-node|\.node$/.test(p)))throw Error('Native runtime must not be shipped to browsers');
  if(Object.values(result.metafile.outputs).flatMap(o=>o.imports).some(i=>i.external))throw Error('Unexpected external Paddle runtime import');
  const code=result.outputFiles[0].contents,filename='runtime-'+sha(code).slice(0,16)+'.mjs';writeFileSync(resolve(output,filename),code);
  for(const name of ['ort-wasm-simd-threaded.asyncify.mjs','ort-wasm-simd-threaded.asyncify.wasm']){const destination=resolve(output,'ort-1.29.0',name);mkdirSync(dirname(destination),{recursive:true});copyFileSync(resolve(root,'node_modules/onnxruntime-web/dist',name),destination);}
  for(const a of manifest.assets)for(const p of a.chunks){const destination=resolve(output,'models',REVISION,p.file);mkdirSync(dirname(destination),{recursive:true});copyFileSync(resolve(modelDir,p.file),destination);}
  copyFileSync(resolve(modelDir,'assets.json'),resolve(output,'models',REVISION,'assets.json'));
  const metadata={revision:REVISION,runtimeURL:'/ocr/paddle/'+filename,runtimeSHA256:sha(code),modelBytes:manifest.totalSize};
  writeFileSync(resolve(root,'vendor/paddle/web-build.json'),JSON.stringify(metadata,null,2)+'\n');
  console.log('Built browser Paddle runtime ('+code.length+' bytes); public model assets '+manifest.totalSize+' bytes.');return metadata;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildPaddleWeb();
