const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../../'),ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'engine.js'),'utf8'),ctx);
const word=(text,x,y,w=.35)=>({text,box:[x,y,x+w,y+.015]});
test('column order reads left body before right body without losing spanning headings',()=>{
 const a=word('heading',.05,.01,.9),lines=[];for(let i=0;i<12;i++)lines.push(word('left paragraph '+i,.05,.1+i*.025),word('right paragraph '+i,.55,.1+i*.025));
 const r=ctx.ppv5ReadingOrder([a,...lines]);assert.equal(r.columns,2);assert.equal(r.words[0],a);assert.equal(r.words.length,25);assert.equal(new Set(r.words).size,25);assert.equal(r.words[1].text,'left paragraph 0');assert.equal(r.words[13].text,'right paragraph 0');
});
test('short form labels are not misclassified as two text columns',()=>{
 const words=[];for(let i=0;i<15;i++)words.push(word('a',.1,.1+i*.025),word('b',.6,.1+i*.025));const r=ctx.ppv5ReadingOrder(words);assert.equal(r.columns,1);assert.equal(r.words.length,30);assert.equal(r.words[1].text,'b');
});
test('standalone scripts parse, external script dependencies are absent, cloud endpoints excluded',()=>{
 const html=fs.readFileSync(path.join(root,'dist/PP-OCRv5-Korean-Trial.html'),'utf8');assert.doesNotMatch(html,/<script[^>]+src=/);assert.match(html,/connect-src blob: data:/);assert.doesNotMatch(html,/vision\.googleapis\.com|generativelanguage\.googleapis\.com/);
 for(const m of html.matchAll(/<script(?![^>]*application\/octet-stream)[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});

test('same-line characters with small vertical jitter keep left-to-right order',()=>{const a=word('위',.3,.102,.05),b=word('임',.5,.101,.05),c=word('장',.7,.1,.05);const r=ctx.ppv5ReadingOrder([c,b,a]);assert.equal(r.words.map(w=>w.text).join(''),'위임장');});
