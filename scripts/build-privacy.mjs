import {build,transform} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let assets;
export async function buildPrivacyAssets(){
  // Module Workers cannot load blobs from a local HTML's opaque origin.
  // A side-effect entry and async wrapper retain MuPDF's async initialization
  // in a classic Worker, using only verified, transferred WASM bytes.
  const result=await build({
    stdin:{contents:"import './src/privacy-native-worker.js';",resolveDir:root},
    bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,
    define:{process:'undefined','import.meta.url':'""'},
    plugins:[{name:'privacy-browser-only',setup(b){
      b.onResolve({filter:/^(?:module|node:fs)$/},args=>({path:args.path,namespace:'no-node'}));
      b.onLoad({filter:/.*/,namespace:'no-node'},()=>({contents:'export function createRequire(){throw Error("Node runtime unavailable");}'}));
    }}]
  });
  const worker=await transform(`(async()=>{
    const init=await new Promise(resolve=>self.onmessage=({data})=>resolve(data));
    // Compile before entering Emscripten. Its default failure path rejects both
    // the async factory and an internal ready promise, leaving one unhandled.
    const wasmModule=await WebAssembly.compile(init.wasm);
    globalThis.$libmupdf_wasm_Module={locateFile:()=>'',instantiateWasm(imports,receive){
      const instance=new WebAssembly.Instance(wasmModule,imports);
      receive(instance,wasmModule);return instance.exports;
    }};
    ${result.outputFiles[0].text}
  })().catch(error=>self.postMessage({error:'개인정보 삭제 엔진을 시작하지 못했습니다: '+(error?.message||String(error))}));`,{format:'iife',target:'es2022',minify:true});
  assets={};const folder=resolve(root,'.deploy/privacy');mkdirSync(folder,{recursive:true});
  for(const [name,bytes]of [['worker',Buffer.from(worker.code)],['wasm',readFileSync(resolve(root,'node_modules/mupdf/dist/mupdf-wasm.wasm'))]]){
    const packed=deflateSync(bytes,{level:9}),sha=createHash('sha256').update(packed).digest('hex'),url='/privacy/'+sha+'.zlib';
    assets[name]={url,sha256:sha,bytes:packed.length,packed};writeFileSync(resolve(root,'.deploy'+url),packed);
  }
  return assets;
}
export function privacyHTML(standalone){
  if(!assets)throw Error('Build privacy assets before HTML');
  const manifest=Object.fromEntries(Object.entries(assets).map(([k,v])=>[k,{url:v.url,sha256:v.sha256,bytes:v.bytes}]));
  return '<script>globalThis.PDFPrivacyAssets='+JSON.stringify(manifest)+'</script>\n'+(standalone?Object.entries(assets).map(([k,v])=>'<script type="application/octet-stream" id="privacy-'+k+'">'+v.packed.toString('base64')+'</script>').join('\n'):'');
}
