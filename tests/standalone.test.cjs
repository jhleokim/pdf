const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const web=fs.readFileSync(path.join(root,'index.html'),'utf8');
let offlinePromise;
const offlineHTML=()=>offlinePromise??=import('../scripts/build.mjs').then(({buildHTML})=>buildHTML({standalone:true}));
const normalized=text=>text.replace(/\r\n/g,'\n').trim();

test('offline build has parseable inline scripts and no external executable/style dependencies',async()=>{
  const html=await offlineHTML();
  assert.doesNotMatch(html,/<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html,/<link\b[^>]*rel=["']stylesheet/i);
  assert.doesNotMatch(html,/@import\s+(url|["'])/i);
  const scripts=[...html.matchAll(/<script\b(?![^>]*type="application\/octet-stream")[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length>=8);
  for(let i=0;i<scripts.length;i++)new vm.Script(scripts[i][1],{filename:`offline-inline-${i}.js`});
});

test('web bootstrap and common inline application scripts remain parseable',()=>{
  const scripts=[...web.matchAll(/<script\b(?![^>]*type="application\/octet-stream")[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.some(match=>match[0].includes('id="paddle-bootstrap"')),'web runtime bootstrap is present');
  for(let i=0;i<scripts.length;i++)new vm.Script(scripts[i][1],{filename:`web-inline-${i}.js`});
});

test('both builds have unique control ids and embed the current common application sources',async()=>{
  const common=['editor','pro-engine','pro-document','pro-deskew','pro-pipeline','pro-rail','pro-result','pro-live-preview','pro-ui','pro-stamp','pro-ocr','pro-tools-ui','markup-text','markup-editor','text-editor-ui','markup-highlight','save-ui','edit-history','print-ui'];
  for(const [kind,html] of [['web',web],['offline',await offlineHTML()]]){
    const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
    const ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length,kind+': duplicate ids break UI event bindings');
    for(const name of [...common,...(kind==='web'?['pro-gemini','pro-vision','pro-vision-ui','pro-vision-unlock']:[])]){
      const id=name==='editor'?'editor-code':name;
      const match=html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
      assert.ok(match,`${kind}: ${id} embedded`);
      assert.equal(normalized(match[1]),normalized(fs.readFileSync(path.join(root,'src',name+'.js'),'utf8')),`${kind}: ${name}: run build before delivery`);
    }
    if(kind==='offline')assert.doesNotMatch(html,/<script id="pro-gemini(?:-ui)?">/,'cloud client and hidden unlock code stay web-only');
  }
});
