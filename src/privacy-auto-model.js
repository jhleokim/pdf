/* OCR cleanup and explicit preferences for local privacy suggestions. */
(function(root){
  'use strict';
  const TYPE_IDS=['rrn','account','card','phone','email','name','address'];
  const MAX_PRESETS=8,MAX_NAME=24,MAX_WORDS=50000,MAX_BOXES=20000,MAX_CHARS=500000,EDGE_EPSILON=1e-7;
  let nextId=0;
  function fail(message,code='PRIVACY_AUTO_INVALID'){const e=new Error(message);e.code=code;throw e;}
  const validBox=b=>Array.isArray(b)&&b.length===4&&b.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&b[2]>b[0]&&b[3]>b[1];
  const finiteArray=(a,length)=>Array.isArray(a)&&a.length===length&&a.every(Number.isFinite);
  function normalSettings(value){
    const selected=Array.isArray(value?.types)?value.types:['rrn','account','card'];
    return {types:TYPE_IDS.filter(id=>selected.includes(id)),style:value?.style==='partial'?'partial':'full'};
  }
  function cleanName(value){
    if(typeof value!=='string')return '';
    const name=value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/gu,' ').trim();
    return [...name].length<=MAX_NAME?name:'';
  }
  function readPresets(raw){
    if(typeof raw==='string'){
      if(raw.length>20000)return [];
      try{raw=JSON.parse(raw);}catch{return [];}
    }
    if(!Array.isArray(raw))return [];
    const result=[],seenIds=new Set(),seenNames=new Set();
    for(const item of raw.slice(0,64)){
      if(!item||typeof item!=='object'||typeof item.id!=='string'||!/^custom-[a-z0-9-]{1,56}$/.test(item.id))continue;
      const name=cleanName(item.name),settings=normalSettings(item);
      if(!name||!Array.isArray(item.types)||!settings.types.length||seenIds.has(item.id)||seenNames.has(name))continue;
      result.push({id:item.id,name,types:settings.types,style:settings.style});seenIds.add(item.id);seenNames.add(name);
      if(result.length===MAX_PRESETS)break;
    }
    return result;
  }
  function savePreset(list,name,settings){
    const value=cleanName(name),result=readPresets(list),choice=normalSettings(settings);
    if(!value)fail('프리셋 이름을 1~24자로 입력해 주세요.','PRIVACY_PRESET_NAME');
    if(!choice.types.length)fail('프리셋에 저장할 개인정보 종류를 선택해 주세요.','PRIVACY_PRESET_TYPES');
    const at=result.findIndex(item=>item.name===value);
    if(at>=0)result[at]={id:result[at].id,name:value,...choice};
    else{
      if(result.length>=MAX_PRESETS)fail('프리셋은 8개까지 저장할 수 있습니다. 기존 프리셋을 지우거나 같은 이름으로 저장해 주세요.','PRIVACY_PRESET_LIMIT');
      let id;do{id='custom-'+Date.now().toString(36)+'-'+(++nextId).toString(36)+'-'+Math.random().toString(36).slice(2,10);}while(result.some(item=>item.id===id));
      result.push({id,name:value,...choice});
    }
    return result;
  }
  function removePreset(list,id){return readPresets(list).filter(item=>item.id!==id);}
  function maskIndex(boxes){
    if(!Array.isArray(boxes)||boxes.length>MAX_BOXES||!boxes.every(validBox))fail('개인정보 가리기 영역을 확인하지 못했습니다. 영역을 다시 확인해 주세요.');
    const rows=Array.from({length:64},()=>[]),row=y=>Math.min(63,Math.max(0,Math.floor(y*64)));
    for(const box of boxes)for(let i=row(box[1]-EDGE_EPSILON);i<=row(box[3]+EDGE_EPSILON);i++)rows[i].push(box);
    return box=>{
      for(let i=row(box[1]-EDGE_EPSILON);i<=row(box[3]+EDGE_EPSILON);i++)for(const mask of rows[i]){
        // Exact edge contact is excluded from the searchable layer as well.
        // A tiny normalized tolerance covers arithmetic drift at that edge.
        if(box[0]<=mask[2]+EDGE_EPSILON&&box[2]>=mask[0]-EDGE_EPSILON&&box[1]<=mask[3]+EDGE_EPSILON&&box[3]>=mask[1]-EDGE_EPSILON)return true;
      }
      return false;
    };
  }
  function copyWord(word){
    const out={text:word.text,box:[...word.box]};
    if(word.separator!==undefined){
      if(typeof word.separator!=='string'||!/^\s{0,8}$/u.test(word.separator))fail('인식 텍스트 구분 형식이 올바르지 않습니다. 다시 인식해 주세요.');
      out.separator=word.separator;
    }
    if(Number.isFinite(word.confidence)||word.confidence===null)out.confidence=word.confidence;
    for(const field of ['uncertain','corrected','correctionLine'])if(typeof word[field]==='boolean')out[field]=word[field];
    if(word.nativeBasis!==undefined){if(!finiteArray(word.nativeBasis,6))fail('인식 텍스트의 배치 정보를 확인하지 못했습니다.');out.nativeBasis=[...word.nativeBasis];}
    if(word.quad!==undefined){
      if(!Array.isArray(word.quad)||word.quad.length!==4||!word.quad.every(point=>finiteArray(point,2)))fail('인식 텍스트의 모서리 위치를 확인하지 못했습니다.');
      out.quad=word.quad.map(point=>[...point]);
    }
    return out;
  }
  function sanitizeRecord(record,boxes,correctionWords){
    if(!record||typeof record!=='object'||!Array.isArray(record.words))fail('정리할 OCR 결과가 없습니다. 텍스트를 먼저 인식해 주세요.');
    const intersects=maskIndex(boxes);
    if(record.correctionLines!==undefined&&typeof correctionWords!=='function')fail('OCR 교정 결과를 확인할 수 없습니다. 교정 내용을 다시 확인해 주세요.');
    const effective=typeof correctionWords==='function'?correctionWords(record):record.words;
    if(!Array.isArray(effective)||effective.length>MAX_WORDS)fail('정리할 OCR 영역이 너무 많거나 올바르지 않습니다. 인식 범위를 나누어 주세요.');
    const words=[];let chars=0;
    for(const word of effective){
      if(!word||typeof word.text!=='string')fail('정리할 OCR 텍스트 형식이 올바르지 않습니다.');
      chars+=word.text.length;if(chars>MAX_CHARS||word.text.length>60000)fail('정리할 OCR 텍스트가 너무 큽니다. 인식 범위를 나누어 주세요.');
      if(!word.text.trim())continue;
      if(!validBox(word.box))fail('인식 텍스트의 위치가 올바르지 않습니다. 다시 인식해 주세요.');
      // Removing just a substring would retain guessed coordinates and may
      // leave the original sensitive value searchable. Drop the complete run.
      if(!intersects(word.box))words.push(copyWord(word));
    }
    const out={};
    // Opaque cache keys are handed back for the controller to replace in the
    // same transaction as the new masks. Do not retain arbitrary OCR payloads.
    for(const field of ['uid','key','privacyKey','source','language','layout','coverage','modelCacheTag','coordinateStatus','granularity','model']){
      if(typeof record[field]==='string'||record[field]===null)out[field]=record[field];
    }
    if(Number.isInteger(record.page)&&record.page>=0)out.page=record.page;
    if(Number.isFinite(record.confidence)||record.confidence===null)out.confidence=record.confidence;
    for(const field of ['canEmbed','nativeTextUnmapped','skipped'])if(typeof record[field]==='boolean')out[field]=record[field];
    if(record.nativeTextBoxes!==undefined){
      if(!Array.isArray(record.nativeTextBoxes)||record.nativeTextBoxes.length>MAX_WORDS||!record.nativeTextBoxes.every(validBox))fail('기존 검색 텍스트의 위치를 확인하지 못했습니다. 다시 인식해 주세요.');
      out.nativeTextBoxes=record.nativeTextBoxes.map(box=>[...box]);
    }
    out.words=words;out.text=words.map(word=>word.text+(word.separator??' ')).join('').trim();
    return out;
  }
  const api=Object.freeze({sanitizeRecord,readPresets,savePreset,removePreset});root.PDFPrivacyAutoModel=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
