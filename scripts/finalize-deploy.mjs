import {lstatSync,readdirSync,readFileSync,rmSync,rmdirSync} from 'node:fs';
import {basename,isAbsolute,relative,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';

// Old pages can request their version's assets long after a deployment. Retain
// valid content-addressed production assets, but never arbitrary QA files.
function historicalHash(file){
  const patterns=[
    /^privacy\/([a-f0-9]{64})\.zlib$/,
    /^markup\/([a-f0-9]{64})-(?:fontkit\.umd\.min\.js|Nanum(?:Gothic|Myeongjo)\.ttf\.zlib|Hana2-(?:Regular|Bold)\.ttf\.zlib)$/,
    /^ocr\/tesseract\/\d+\.\d+\.\d+\/([a-f0-9]{64})-(?:tesseract\.min\.js|tesseract-core-(?:relaxedsimd-)?lstm\.wasm\.js|worker\.min\.js|(?:kor|eng)\.traineddata\.gz)$/,
    /^ocr\/ppocr-v5\/(?:adapter|ort|opencv|engine|worker)-([a-f0-9]{16})\.js$/,
    /^ocr\/ppocr-v5\/ort-wasm-simd-threaded-([a-f0-9]{16})\.(?:mjs|wasm)$/,
    /^ocr\/ppocr-v5\/(?:det|rec)-([a-f0-9]{16})\.onnx$/,
    /^ocr\/ppocr-v5\/dict-([a-f0-9]{16})\.json$/
  ];
  for(const pattern of patterns){const match=file.match(pattern);if(match)return match[1];}
  return null;
}

// Only generated deployment files are eligible for removal. Validate the entire
// current release before pruning so a partial build cannot erase usable assets.
export function finalizeDeploy(directory,entries){
  const root=resolve(directory);
  if(basename(root)!=='.deploy'||lstatSync(root).isSymbolicLink()||!lstatSync(root).isDirectory())throw Error('Unsafe generated deployment directory');
  const within=file=>{
    if(typeof file!=='string'||!file||isAbsolute(file))throw Error('Unsafe generated asset path');
    const absolute=resolve(root,file);
    if(!absolute.startsWith(root+sep))throw Error('Unsafe generated asset path');
    return relative(root,absolute).split(sep).join('/');
  };
  const required=new Map(entries.map(entry=>[within(entry.file),entry]));
  if(!required.has('index.html')||!required.has('_headers'))throw Error('Missing deployment entry points');
  const found=new Map(),directories=[];
  function visit(folder){
    for(const name of readdirSync(folder)){
      const absolute=resolve(folder,name),file=within(relative(root,absolute)),stat=lstatSync(absolute);
      if(stat.isSymbolicLink())throw Error('Symbolic links are not deployable: '+file);
      if(stat.isDirectory()){visit(absolute);directories.push(absolute);}
      else if(stat.isFile())found.set(file,absolute);
      else throw Error('Unsupported deployment entry: '+file);
    }
  }
  visit(root);
  for(const [file,entry]of required){
    if(!found.has(file))throw Error('Missing deployment asset: '+file);
    if(entry.sha256!==undefined||entry.bytes!==undefined){
      const bytes=readFileSync(found.get(file));
      if(!Number.isSafeInteger(entry.bytes)||!/^[a-f0-9]{64}$/.test(entry.sha256)||bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Deployment asset integrity mismatch: '+file);
    }
  }
  const removed=[];
  for(const [file,absolute]of found)if(!required.has(file)){
    const hash=historicalHash(file);
    if(hash&&createHash('sha256').update(readFileSync(absolute)).digest('hex').startsWith(hash))continue;
    rmSync(absolute);removed.push(file);
  }
  for(const folder of directories)if(readdirSync(folder).length===0)rmdirSync(folder);
  return removed;
}
