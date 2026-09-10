const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/edit-history.js'),'utf8');
const code=source.slice(source.indexOf('class EditHistoryStack'),source.indexOf('const editHistory='));
function stack(limit=50,budget=8388608){const context=vm.createContext({Date});vm.runInContext(code+';this.Stack=EditHistoryStack;',context);return new context.Stack(limit,budget);}
const state=n=>({signature:String(n),value:n});
test('history preserves chronological undo/redo and drops redo only after an actual new edit',()=>{
 const h=stack();h.push(state(0),state(1),'one');h.push(state(1),state(2),'two');assert.equal(h.take().state.value,1);assert.equal(h.take().state.value,0);assert.equal(h.take(true).state.value,1);
 assert.equal(h.push(state(1),state(1),'no-op'),false);assert.equal(h.redo.length,1);h.push(state(1),state(3),'branch');assert.equal(h.redo.length,0);assert.equal(h.take().state.value,1);
});
test('continuous changes coalesce only across contiguous states with the same control',()=>{
 const h=stack();h.push(state(0),state(1),'size','size');h.push(state(1),state(2),'size','size');assert.equal(h.undo.length,1);assert.equal(h.take().state.value,0);h.take(true);h.push(state(2),state(3),'size','size');assert.equal(h.undo.length,2);
 h.push(state(7),state(8),'size','size');assert.equal(h.undo.length,3);h.push(state(8),state(9),'color','color');assert.equal(h.undo.length,4);
});
test('returning a slider to its original value does not leave an empty undo action',()=>{
 const h=stack();h.push(state(0),state(1),'size','size');h.push(state(1),state(0),'size','size');assert.equal(h.undo.length,0);
});
test('entry count and metadata budget are bounded while retaining the latest operation',()=>{
 const h=stack(3);for(let i=0;i<10;i++)h.push(state(i),state(i+1),'edit');assert.equal(h.undo.length,3);assert.equal(h.take().state.value,9);
 const b=stack(50,20);b.push(state('aaaa'),state('bbbb'),'first');b.push(state('bbbb'),state('cccc'),'second');assert.equal(b.undo.length,1);assert.equal(b.take().label,'second');b.clear();assert.equal(b.redo.length,0);
});
