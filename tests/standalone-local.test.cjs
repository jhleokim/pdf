const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),web=fs.readFileSync(path.join(root,'index.html'),'utf8');
test('standalone removes cloud entry points and client while preserving local engines',async()=>{
  const {buildHTML}=await import('../scripts/build.mjs'),offline=buildHTML({standalone:true});
  assert.match(web,/id="geminiTools"/);
  assert.match(web,/id="pro-gemini"/);
  assert.doesNotMatch(offline,/id="(?:gemini\w*|pro-gemini)"|geminiClicks|\/api\/ocr\/gemini|generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(offline,/<script\b[^>]*\bsrc\s*=/i);
  const script=(html,id)=>html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))?.[1];
  for(const id of ['ocr-client','ocr-core','ocr-core-fast','ocr-worker','ocr-lang-kor','ocr-lang-eng','pro-ocr','pro-stamp','editor-code']){
    assert.ok(script(offline,id),id);assert.equal(script(offline,id),script(web,id),id+' unchanged');
  }
  for(const match of offline.matchAll(/<script\b(?![^>]*type="application\/octet-stream")[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  assert.equal(buildHTML().replace(/\r\n/g,'\n'),web.replace(/\r\n/g,'\n'),'Hosted build remains independently reproducible');
});
