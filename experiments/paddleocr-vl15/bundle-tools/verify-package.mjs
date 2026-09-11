/** Stream-verify all embedded asset hashes without reading a multi-GB HTML string. */
import {createReadStream} from 'node:fs';
import {open,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const file=resolve(process.argv[2]);const details=await stat(file),handle=await open(file,'r');
const tail=Buffer.alloc(Math.min(details.size,16*1024*1024));
await handle.read(tail,0,tail.length,details.size-tail.length);await handle.close();
const manifestMatch=tail.toString('utf8').match(/const manifest=(.+?), assets=new Map/);
assert.ok(manifestMatch,'embedded manifest is in the bounded final runtime block');
const manifest=JSON.parse(manifestMatch[1]),hashes=new Map(),counts=new Map(),sizes=new Map();
const htmlHash=createHash('sha256'),openRE=/<script type="application\/octet-stream" id="(pa\d+)-(\d+)">/;
let pending='',active=null,maximumBase64=0,totalChunks=0;
for await(const buffer of createReadStream(file,{highWaterMark:1024*1024})){
  htmlHash.update(buffer);pending+=buffer.toString('ascii');
  while(true){
    if(!active){const match=pending.match(openRE);if(!match){pending=pending.slice(-256);break;}active={id:match[1],index:Number(match[2])};pending=pending.slice(match.index+match[0].length);}
    const end=pending.indexOf('</script>');if(end<0){assert.ok(pending.length<=32*1024*1024+1024*1024,'Base64 chunk is bounded');break;}
    const encoded=pending.slice(0,end);assert.ok(/^[A-Za-z0-9+/=]+$/.test(encoded));
    const decoded=Buffer.from(encoded,'base64');maximumBase64=Math.max(maximumBase64,encoded.length);totalChunks++;
    if(!hashes.has(active.id))hashes.set(active.id,createHash('sha256'));
    assert.equal(active.index,counts.get(active.id)||0,'chunk order is contiguous');
    hashes.get(active.id).update(decoded);counts.set(active.id,active.index+1);sizes.set(active.id,(sizes.get(active.id)||0)+decoded.length);
    pending=pending.slice(end+9);active=null;
  }
}
assert.equal(active,null,'no partial asset block');assert.ok(maximumBase64<=32*1024*1024);
for(const asset of manifest.assets){assert.equal(counts.get(asset.id),asset.chunks,asset.path+' chunks');assert.equal(sizes.get(asset.id),asset.size,asset.path+' bytes');assert.equal(hashes.get(asset.id).digest('hex'),asset.sha256,asset.path+' SHA-256');}
const result={file,htmlBytes:details.size,htmlSha256:htmlHash.digest('hex'),assets:manifest.assets.length,totalChunks,maximumBase64Bytes:maximumBase64,modelBytes:manifest.modelBytes,verifiedAt:new Date().toISOString(),status:'all embedded asset hashes match'};
await writeFile(file+'.verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
