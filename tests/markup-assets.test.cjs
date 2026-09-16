const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const code=fs.readFileSync(require('node:path').join(__dirname,'../src/markup-assets.js'),'utf8');
const bytes=new Uint8Array([1,2,3,4]),asset={url:'/markup/sample',bytes:4,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
function setup({embedded=false,entry=asset,response=bytes}={}){
 let calls=0;const ctx={document:{getElementById:()=>embedded?{textContent:'AQIDBA=='}:null},b64bytes:b64=>new Uint8Array(Buffer.from(b64,'base64')),PDFMarkupManifest:{font:entry},location:{href:'https://pdf.example/',origin:'https://pdf.example'},URL,Uint8Array,AbortController,setTimeout,clearTimeout,crypto:crypto.webcrypto,fetch:async()=>{calls++;return {ok:true,arrayBuffer:async()=>response.buffer.slice(response.byteOffset,response.byteOffset+response.byteLength)}}};
 vm.createContext(ctx);vm.runInContext(code,ctx);return {get:vm.runInContext('PDFMarkupAssets.get',ctx),calls:()=>calls,ctx};
}
test('font loader is idle until used, combines in-flight requests and validates content',async()=>{
 const s=setup();assert.equal(s.calls(),0);const [a,b]=await Promise.all([s.get('font'),s.get('font')]);assert.equal(s.calls(),1);assert.deepEqual([...a],[...bytes]);assert.equal(a,b);
});
test('offline font bytes never consult the network',async()=>{
 const s=setup({embedded:true});assert.deepEqual([...await s.get('font')],[...bytes]);assert.equal(s.calls(),0);
});
test('missing, redirected-origin, corrupt and incomplete assets fail without poisoning retries',async()=>{
 const s=setup({response:new Uint8Array([1,2,3,5])});await assert.rejects(s.get('font'),/검증/);
 s.ctx.fetch=async()=>({ok:true,arrayBuffer:async()=>bytes.buffer});assert.deepEqual([...await s.get('font')],[...bytes]);
 await assert.rejects(setup({response:new Uint8Array([1])}).get('font'),/손상/);
 await assert.rejects(s.get('missing'),/데이터가 없습니다/);
 const foreign=setup({entry:{...asset,url:'https://outside.example/markup/font'}});await assert.rejects(foreign.get('font'),/주소/);assert.equal(foreign.calls(),0);
});
test('web references hash-named assets while standalone embeds exactly the verified fonts',async()=>{
 const {buildHTML,markupWebAssets}=await import('../scripts/build.mjs'),web=buildHTML(),offline=buildHTML({standalone:true});
 for(const [id,asset]of Object.entries(markupWebAssets)){
  assert.ok(web.includes(asset.url));assert.ok(asset.url.includes(asset.sha256));assert.ok(!web.includes('id="'+id+'"'));
  const data=offline.match(new RegExp('id="'+id+'">([^<]+)</script>'));
  assert.ok(data);const buf=Buffer.from(data[1],'base64');assert.equal(buf.length,asset.bytes);assert.equal(crypto.createHash('sha256').update(buf).digest('hex'),asset.sha256);
 }
 assert.ok(!offline.includes('globalThis.PDFMarkupManifest='));assert.ok(web.includes('id="ocr-search-font"'));
});
