const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function harness(data){const calls=[];class Reader{readAsDataURL(){this.result='data:image/jpeg;base64,/9j/AAAAAAAAAAAA';queueMicrotask(()=>this.onload());}abort(){this.onabort?.();}}
 const context={URL,AbortController,DOMException,Uint8Array,TextDecoder,Date,setTimeout,clearTimeout,FileReader:Reader,location:{protocol:'https:',href:'https://pdf.test/'},fetch:async(url,init)=>{calls.push({url,init});return Response.json(data);}};
 vm.createContext(context);for(const file of ['pro-gemini.js','pro-vision.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context);
 return {api:context.PDFVision,calls,canvas:{width:100,height:200,toBlob:cb=>queueMicrotask(()=>cb({type:'image/jpeg',size:100}))}};
}
const result={text:'한글\n',model:'builtin/latest',words:[{text:'한글',box:[0,0,.5,.1],separator:'\n',confidence:91}]};
test('Vision client requires consent and calls only its dedicated endpoint',async()=>{
 const h=harness(result),signal=new AbortController().signal;await assert.rejects(h.api.session('kor+eng',signal,null,false));assert.equal(h.calls.length,0);
 const session=await h.api.session('kor+eng',signal,null,true),actual=await session.recognize(h.canvas);assert.equal(actual.source,'vision');assert.equal(actual.words[0].confidence,91);assert.equal(actual.words[0].separator,'\n');assert.equal(h.calls[0].url,'https://pdf.test/api/ocr/vision');assert.equal(h.calls[0].init.credentials,'omit');await session.close();
});
test('invalid word geometry rejects the whole Vision result before PDF embedding',async()=>{
 for(const bad of [{...result.words[0],box:[0,0,0,.1]},{...result.words[0],confidence:'91'},{...result.words[0],text:'bad\u0000'}]){
 const h=harness({...result,words:[bad]}),s=await h.api.session('eng',new AbortController().signal,null,true);await assert.rejects(s.recognize(h.canvas));await s.close();
 }
});
test('missing confidence stays unknown instead of displaying an invented score',async()=>{
 const h=harness({...result,words:[{...result.words[0],confidence:null}]}),s=await h.api.session('eng',new AbortController().signal,null,true);assert.equal((await s.recognize(h.canvas)).confidence,null);await s.close();
});
