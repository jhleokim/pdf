const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
test('standalone contains parseable inline scripts and no external executable/style dependencies',()=>{
  assert.doesNotMatch(html,/<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html,/<link\b[^>]*rel=["']stylesheet/i);
  assert.doesNotMatch(html,/@import\s+(url|["'])/i);
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length>=8);
  for(let i=0;i<scripts.length;i++)new vm.Script(scripts[i][1],{filename:`inline-${i}.js`});
});
test('all HTML control ids are unique and application sources match embedded output',()=>{
  const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
  const ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,'Duplicate ids break UI event bindings');
  for(const name of ['editor','pro-engine','pro-document','pro-ui']){
    const id=name==='editor'?'editor-code':name;
    const match=html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
    assert.ok(match,`${id} embedded`);
    assert.equal(match[1].trim(),fs.readFileSync(path.join(root,'src',name+'.js'),'utf8').trim(),`${name}: run build before delivery`);
  }
});
