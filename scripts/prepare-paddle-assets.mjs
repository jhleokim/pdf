/** Prepare verified local model files for Cloudflare Static Assets. No downloads.
 * Run: node scripts/prepare-paddle-assets.mjs
 * Set PADDLE_MODEL_DIR to the existing directory containing onnx/ and tokenizer files.
 * Every emitted file is at most 20 MiB; the browser reassembles the original bytes.
 */
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,existsSync,lstatSync,mkdirSync,openSync,closeSync,readSync,realpathSync,
  renameSync,statSync,unlinkSync,writeFileSync,readFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep,posix} from 'node:path';
import {fileURLToPath} from 'node:url';

export const MODEL='onnx-community/PaddleOCR-VL-1.5-ONNX';
export const REVISION='ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4';
export const CHUNK_SIZE=20*1024*1024;
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const REQUIRED_ASSETS=Object.freeze([
  {path:'onnx/embedding.onnx',size:1826,sha256:'91b1babbe9dbc44f2b59f8462cbf27dd1520a88b1b85695e342b05e5b4a50004'},
  {path:'onnx/embedding.onnx.data',size:423624704,sha256:'a2299447a5449d9bc68e4d1d1ab32b214a0e8c06f98244fbc7487342187ae6f3'},
  {path:'onnx/vision_encoder_q4.onnx',size:231128624,sha256:'d737d600be1bd90ec1e3b537ffe1645a6d780de688904ca4301353df6086f46e'},
  {path:'onnx/decoder_q4.onnx',size:233566043,sha256:'87858a011c3f5ae8b373ec7298fba781dfe3ceb49828a803a197becdee26853c'},
  {path:'tokenizer.json',size:11189060,sha256:'c8a215a59183d0d0781adc33bacd3ce6162716f7fd568fb30234a74d69803a7d'},
  // The source manifest records this small file as a Git blob, not an LFS object.
  {path:'tokenizer_config.json',size:877,sha256:'9aea1a7eae0d1c0c9d1bacc30a0ea5b0688cff2610f46f07e9fdb905f57f0b0a',blobId:'4d8a7984c12f48876ba24e3f0bd88797bdef4311'},
].map(Object.freeze));

function inside(base,target){const rel=relative(base,target);return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));}
function relativeName(name){
  if(typeof name!=='string'||!name||name.includes('\\')||posix.isAbsolute(name)||posix.normalize(name)!==name||name.split('/').some(v=>v==='..'||v==='.')||!/^[a-zA-Z0-9_./-]+$/.test(name))throw Error('Unsafe asset path: '+name);
  return name;
}

// Resolve every existing ancestor so a junction or symlink cannot redirect writes.
function safeDirectory(base,directory){
  const canonicalBase=realpathSync(base),target=resolve(directory);
  if(!inside(resolve(base),target))throw Error('Output directory is outside the allowed root.');
  let current=resolve(base);
  for(const component of relative(current,target).split(sep).filter(Boolean)){
    current=join(current,component);
    if(!existsSync(current))mkdirSync(current);
    if(!statSync(current).isDirectory()||!inside(canonicalBase,realpathSync(current)))throw Error('Output directory leaves the allowed root.');
  }
  return target;
}

function safeFile(base,name){
  const target=resolve(base,relativeName(name));
  if(!inside(resolve(base),target))throw Error('Output file is outside the allowed root.');
  safeDirectory(base,dirname(target));
  if(existsSync(target)&&(!lstatSync(target).isFile()||lstatSync(target).isSymbolicLink()))throw Error('Output file must be a regular file: '+name);
  return target;
}

function atomicWrite(base,name,bytes){
  const target=safeFile(base,name),temporary=safeFile(base,name+'.tmp-'+process.pid+'-'+randomUUID());
  try{writeFileSync(temporary,bytes,{flag:'wx'});renameSync(temporary,target);}
  finally{if(existsSync(temporary))unlinkSync(temporary);}
}

async function fileHash(path,algorithm='sha256',prefix){
  const hash=createHash(algorithm);if(prefix)hash.update(prefix);
  for await(const bytes of createReadStream(path,{highWaterMark:4*1024*1024}))hash.update(bytes);
  return hash.digest('hex');
}

export function validateSourceManifest(manifest){
  if(manifest.sha!==REVISION||(manifest.id??manifest.modelId)!==MODEL)throw Error('Pinned Paddle model/revision does not match the source manifest.');
  if(!Array.isArray(manifest.siblings))throw Error('Source manifest has no file records.');
  for(const asset of REQUIRED_ASSETS){
    const records=manifest.siblings.filter(item=>item.rfilename===asset.path);
    const record=records[0];
    if(records.length!==1||record.size!==asset.size||(asset.blobId?record.blobId!==asset.blobId:record.lfs?.sha256!==asset.sha256||record.lfs?.size!==asset.size))throw Error('Pinned source manifest mismatch: '+asset.path);
  }
}

export async function verifyOriginal(sourceFile,asset){
  relativeName(asset.path);
  if(!Number.isSafeInteger(asset.size)||asset.size<1||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('Invalid source integrity record.');
  if(!existsSync(sourceFile)||!statSync(sourceFile).isFile()||statSync(sourceFile).size!==asset.size)throw Error('Local model file is missing or has the wrong size: '+asset.path);
  if(await fileHash(sourceFile)!==asset.sha256)throw Error('Local model SHA256 mismatch: '+asset.path);
  if(asset.blobId&&await fileHash(sourceFile,'sha1',Buffer.from(`blob ${asset.size}\0`))!==asset.blobId)throw Error('Local model Git blob mismatch: '+asset.path);
}

export async function splitVerifiedAsset({sourceFile,asset,outputDirectory,chunkSize=CHUNK_SIZE}){
  if(!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>CHUNK_SIZE)throw Error('Chunk size must be between 1 byte and 20 MiB.');
  await verifyOriginal(sourceFile,asset);
  // The caller must create/validate the dedicated output root first.
  if(!existsSync(outputDirectory)||!statSync(outputDirectory).isDirectory())throw Error('Output root does not exist.');
  const chunks=[],completeHash=createHash('sha256'),input=openSync(sourceFile,'r');
  try{
    for(let offset=0,index=0;offset<asset.size;index++){
      const size=Math.min(chunkSize,asset.size-offset),bytes=Buffer.allocUnsafe(size);
      let received=0;
      while(received<size){const count=readSync(input,bytes,received,size-received,offset+received);if(!count)throw Error('Source ended during chunk preparation: '+asset.path);received+=count;}
      completeHash.update(bytes);
      const sha256=createHash('sha256').update(bytes).digest('hex');
      const file=asset.path+'.part-'+String(index).padStart(4,'0'),target=safeFile(outputDirectory,file);
      const reusable=existsSync(target)&&statSync(target).size===size&&await fileHash(target)===sha256;
      if(!reusable)atomicWrite(outputDirectory,file,bytes);
      chunks.push({file,size,sha256});offset+=size;
    }
    if(completeHash.digest('hex')!==asset.sha256||statSync(sourceFile).size!==asset.size)throw Error('Source changed during chunk preparation: '+asset.path);
  }finally{closeSync(input);}
  return {path:asset.path,size:asset.size,sha256:asset.sha256,chunks};
}

function findModelDirectory(){
  const requested=process.env.PADDLE_MODEL_DIR;
  const candidates=requested?[resolve(requested)]:[
    resolve(ROOT,'vendor/paddle/source',REVISION),
    resolve(ROOT,'work/paddle-vl15-browser/models/paddle-vl15-community'),
    resolve(ROOT,'experiments/paddleocr-vl15/models/paddle-vl15-community'),
  ];
  const found=candidates.find(directory=>REQUIRED_ASSETS.every(asset=>existsSync(resolve(directory,asset.path))));
  if(!found)throw Error('Existing Paddle model files were not found. Set PADDLE_MODEL_DIR to their directory. This script never downloads model files.');
  return realpathSync(found);
}

export async function preparePaddleAssets({modelDirectory:providedDirectory}={}){
  const sourceManifest=JSON.parse(readFileSync(resolve(ROOT,'vendor/paddle/model-source.json'),'utf8'));
  validateSourceManifest(sourceManifest);
  const modelDirectory=providedDirectory?realpathSync(resolve(providedDirectory)):findModelDirectory();
  // Reject bad sources before replacing any previously generated asset.
  for(const asset of REQUIRED_ASSETS)await verifyOriginal(resolve(modelDirectory,asset.path),asset);
  const outputDirectory=safeDirectory(ROOT,resolve(ROOT,'vendor/paddle/assets',REVISION)),assets=[];
  for(const asset of REQUIRED_ASSETS){
    assets.push(await splitVerifiedAsset({sourceFile:resolve(modelDirectory,asset.path),asset,outputDirectory}));
    console.log('Verified and prepared '+asset.path);
  }
  const manifest={schemaVersion:1,model:MODEL,revision:REVISION,chunkSize:CHUNK_SIZE,totalSize:assets.reduce((sum,asset)=>sum+asset.size,0),assets};
  // Publish the manifest last. Interrupted runs cannot advertise incomplete assets.
  atomicWrite(outputDirectory,'assets.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  const manifestPath=resolve(outputDirectory,'assets.json');
  console.log(JSON.stringify({manifest:manifestPath,assets:assets.length,chunks:assets.reduce((sum,asset)=>sum+asset.chunks.length,0),bytes:manifest.totalSize}));
  return {manifest,manifestPath};
}

export {safeDirectory,safeFile,atomicWrite};

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length>2){console.error('Usage: node scripts/prepare-paddle-assets.mjs\nOptional environment: PADDLE_MODEL_DIR');process.exitCode=1;}
  else await preparePaddleAssets();
}
