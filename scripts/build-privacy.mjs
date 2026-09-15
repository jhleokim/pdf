import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let assets;
export async function buildPrivacyAssets(){
  const result=await build({entryPoints:[resolve(root,'src/privacy-native-worker.js')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,define:{process:'undefined'},external:['module','node:fs']});
  assets={};const folder=resolve(root,'.deploy/privacy');mkdirSync(folder,{recursive:true});
  for(const [name,bytes]of [['worker',Buffer.from(result.outputFiles[0].contents)],['wasm',readFileSync(resolve(root,'node_modules/mupdf/dist/mupdf-wasm.wasm'))]]){
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
