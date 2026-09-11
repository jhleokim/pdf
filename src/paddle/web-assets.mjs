// Only public, pinned model chunks are fetched. This module never receives a document.
export const PINNED_REVISION='ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4';
const MAX_CHUNK=25*1024*1024,MAX_ASSET=512*1024*1024;
const safePath=value=>typeof value==='string'&&/^[a-zA-Z0-9_./-]+$/.test(value)&&!value.startsWith('/')&&!value.split('/').some(p=>p==='..'||p==='.'||!p);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const check=signal=>signal?.throwIfAborted();

export function createPaddleAssets({manifest,baseURL,fetchImpl=globalThis.fetch,cacheStorage=globalThis.caches,subtle=globalThis.crypto?.subtle,expectedRevision=PINNED_REVISION}){
  manifest=structuredClone(manifest);
  if(manifest?.schemaVersion!==1||manifest.model!=='onnx-community/PaddleOCR-VL-1.5-ONNX'||manifest.revision!==expectedRevision||!Array.isArray(manifest.assets)||!subtle)throw Error('Paddle 모델 목록이 올바르지 않습니다. 페이지를 새로 열어 주세요.');
  if(!Number.isSafeInteger(manifest.chunkSize)||manifest.chunkSize<=0||manifest.chunkSize>MAX_CHUNK)throw Error('모델 조각 크기가 올바르지 않습니다.');
  const base=new URL(baseURL);if(!['https:','http:'].includes(base.protocol)||!base.pathname.endsWith('/'))throw Error('모델 주소가 올바르지 않습니다.');
  const assets=new Map(),files=new Set();let total=0;
  for(const asset of manifest.assets){
    if(!safePath(asset.path)||assets.has(asset.path)||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>MAX_ASSET||!hash(asset.sha256)||!Array.isArray(asset.chunks)||!asset.chunks.length||asset.chunks.length>64)throw Error('모델 파일 정보가 올바르지 않습니다.');
    let size=0;
    for(const chunk of asset.chunks){
      if(!safePath(chunk.file)||files.has(chunk.file)||!Number.isSafeInteger(chunk.size)||chunk.size<=0||chunk.size>manifest.chunkSize||!hash(chunk.sha256))throw Error('모델 조각 정보가 올바르지 않습니다.');
      files.add(chunk.file);size+=chunk.size;
    }
    if(size!==asset.size)throw Error('모델 크기 정보가 일치하지 않습니다.');
    assets.set(asset.path,asset);total+=size;
  }
  if(total!==manifest.totalSize)throw Error('모델 전체 크기가 일치하지 않습니다.');
  const getCache=async()=>{try{return await cacheStorage?.open('pdf-studio-paddle-'+manifest.revision+'-v1')||null;}catch{return null;}};
  const digest=async bytes=>Array.from(new Uint8Array(await subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  async function readChunk(response,chunk,signal){
    check(signal);
    if(!response.ok||!response.body)throw Error('인식 데이터를 받지 못했습니다. 연결을 확인하고 다시 시도하세요.');
    const header=response.headers.get('content-length');
    if(header!==null&&Number(header)!==chunk.size){await response.body.cancel().catch(()=>{});throw Error('인식 데이터 크기가 일치하지 않습니다.');}
    const reader=response.body.getReader(),bytes=new Uint8Array(chunk.size);let offset=0;
    const abort=()=>{void reader.cancel(signal?.reason).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try{
      check(signal);
      while(true){const {done,value}=await reader.read();check(signal);if(done)break;if(offset+value.byteLength>chunk.size){await reader.cancel();throw Error('인식 데이터가 예상 크기를 초과했습니다.');}bytes.set(value,offset);offset+=value.byteLength;}
    }finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
    if(offset!==chunk.size||await digest(bytes)!==chunk.sha256)throw Error('인식 데이터가 손상됐습니다. 다시 시도하세요.');
    check(signal);return bytes;
  }
  async function loadChunk(chunk,cache,signal){
    const url=new URL(chunk.file,base).href;check(signal);
    if(cache){
      let hit;try{hit=await cache.match(url);}catch{}check(signal);
      if(hit)try{return await readChunk(hit,chunk,signal);}catch(error){check(signal);try{await cache.delete(url);}catch{}}
    }
    const response=await fetchImpl(url,{method:'GET',credentials:'omit',cache:'no-cache',signal});
    const bytes=await readChunk(response,chunk,signal);check(signal);
    if(cache)try{await cache.put(url,new Response(bytes,{status:200,headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length)}}));}catch{/* Storage quota/private browsing must not prevent OCR. */}
    check(signal);return bytes;
  }
  return {revision:manifest.revision,async loadAsset(path,signal,onProgress){
    check(signal);const asset=assets.get(path);if(!asset)throw Error('요청한 인식 데이터가 모델 목록에 없습니다.');
    const cache=await getCache();check(signal);const result=new Uint8Array(asset.size);let offset=0;
    for(const chunk of asset.chunks){
      const bytes=await loadChunk(chunk,cache,signal);check(signal);result.set(bytes,offset);offset+=bytes.length;
      onProgress?.({status:'loading assets',assetPath:path,loadedBytes:offset,totalModelBytes:manifest.totalSize,progress:offset/asset.size,detail:'인식 데이터 준비 '+Math.round(offset/1048576)+' / '+Math.round(asset.size/1048576)+' MB'});
    }
    check(signal);return result;
  }};
}
