/* Group OCR words for editing without replacing their original coordinates. */
(() => {
  'use strict';
  const MAX_DIFF_CELLS=1000000,MAX_LINE_LENGTH=60000;
  const normalize=value=>String(value??'').replace(/[\r\n\u2028\u2029]+/g,' ').replace(/\t/g,' ');
  const ending=word=>word.separator??' ';
  const hardBreak=value=>/[\r\n\u2028\u2029]/.test(value);
  function box(word){const b=word?.box;return Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]>=0&&b[1]>=0&&b[2]<=1&&b[3]<=1&&b[2]>b[0]&&b[3]>b[1]?b:null;}
  function sameRow(previous,next){
    const a=box(previous),b=box(next);if(!a||!b)return false;
    const ah=a[3]-a[1],bh=b[3]-b[1],height=Math.min(ah,bh),overlap=Math.min(a[3],b[3])-Math.max(a[1],b[1]);
    const punctuation=word=>/^[\p{P}\p{S}]+$/u.test(String(word.text||''));
    const smallPunctuation=punctuation(previous)||punctuation(next);
    let rowHeight=height;
    if(smallPunctuation){
      // Vision often gives a comma or period only its small ink bounding box.
      const large=ah>=bh?a:b,small=ah>=bh?b:a,h=Math.max(ah,bh),center=(small[1]+small[3])/2;
      if(center<large[1]-h*.15||center>large[3]+h*.25)return false;
      rowHeight=h;
    }else if(overlap<height*.55||Math.max(ah,bh)>height*1.9||Math.abs(a[1]+a[3]-b[1]-b[3])>height*1.3)return false;
    const gap=b[0]-a[2];
    // Permit subpixel OCR box jitter; substantial overlap is a separate region.
    if(gap< -Math.min(.0005,rowHeight*.08)||b[0]<a[0])return false;
    const glyphA=(a[2]-a[0])/Math.max(1,[...String(previous.text||'')].length),glyphB=(b[2]-b[0])/Math.max(1,[...String(next.text||'')].length);
    // Both terms are horizontal normalized lengths. A page's normalized text
    // height cannot bound its horizontal spacing without its aspect ratio.
    return gap<=Math.min(.018,Math.max(glyphA,glyphB)*1.5);
  }
  function group(record){
    const words=Array.isArray(record?.words)?record.words:[];
    if(record?.skipped)return [];
    if(record?.granularity==='line'||['paddle-v5','paddle-vl15','gemini'].includes(record?.source))return words.map((_,index)=>({indices:[index]}));
    const saved=new Map();
    for(const entry of [...record?.correctionGroups||[],...record?.correctionLines||[]]){const indices=entry?.indices;if(Array.isArray(indices)&&indices.length&&indices.every((index,at)=>Number.isInteger(index)&&index>=0&&!!words[index]&&(!at||index===indices[at-1]+1)))saved.set(indices[0],indices);}
    const result=[];let current=null,length=0;
    for(let index=0;index<words.length;index++){
      if(saved.has(index)){const indices=saved.get(index);result.push({indices:[...indices]});index=indices[indices.length-1];current=null;length=0;continue;}
      const word=words[index];
      const previous=words[index-1];
      if(!current||hardBreak(ending(previous))||!sameRow(previous,word)||length+String(word.text||'').length>4000){current={indices:[]};result.push(current);length=0;}
      current.indices.push(index);length+=String(word.text||'').length+String(ending(word)).length;
    }
    return result;
  }
  function indicesOf(record,line){
    const indices=line?.indices;
    if(!Array.isArray(indices)||!indices.length||indices.some((index,i)=>!Number.isInteger(index)||index<0||!record?.words?.[index]||i>0&&index<=indices[i-1]))throw new RangeError('교정할 글줄 영역이 올바르지 않습니다.');
    return indices;
  }
  function layout(record,line){
    const indices=indicesOf(record,line),ranges=[];let text='';
    indices.forEach((index,at)=>{const word=record.words[index],start=text.length;text+=normalize(word.text);ranges.push({index,start,end:text.length});if(at<indices.length-1)text+=normalize(ending(word));});
    return {text,ranges};
  }
  function units(record,indices){
    const chars=[],owners=[],kinds=[];
    indices.forEach((index,at)=>{for(const char of normalize(record.words[index].text)){chars.push(char);owners.push(index);kinds.push('text');}if(at<indices.length-1)for(const char of normalize(ending(record.words[index]))){chars.push(char);owners.push(index);kinds.push('separator');}});
    return {chars,owners,kinds};
  }
  function insertionOwner(base,position,fallback,onlyWhitespace=false){
    // New content after a word's separating space belongs beside the next word.
    if(onlyWhitespace&&position>0&&base.kinds[position-1]==='separator')return base.owners[position-1];
    if(position<base.owners.length&&(position===0||base.kinds[position-1]==='separator'))return base.owners[position];
    return base.owners[Math.max(0,position-1)]??base.owners[position]??fallback;
  }
  function matchOwners(base,target,fallback){
    const source=base.chars,n=source.length,m=target.length,owners=new Array(m);
    let first=0,oldEnd=n,newEnd=m,matched=0;
    while(first<oldEnd&&first<newEnd&&source[first]===target[first]){owners[first]=base.owners[first];if(/\S/u.test(source[first]))matched++;first++;}
    while(oldEnd>first&&newEnd>first&&source[oldEnd-1]===target[newEnd-1]){oldEnd--;newEnd--;owners[newEnd]=base.owners[oldEnd];if(/\S/u.test(source[oldEnd]))matched++;}
    const rows=oldEnd-first,cols=newEnd-first;
    if(!cols)return {owners,matched,bounded:false};
    if(!rows){const owner=insertionOwner(base,first,fallback,target.slice(first,newEnd).every(char=>/\s/u.test(char)));for(let j=first;j<newEnd;j++)owners[j]=owner;return {owners,matched,bounded:false};}
    if((rows+1)*(cols+1)>MAX_DIFF_CELLS){
      // An unanchored paste can be enormous. Keep its prefix/suffix slots exact;
      // place the replacement at its first affected region, never evenly split it.
      const owner=base.owners[first]??insertionOwner(base,first,fallback);
      for(let j=first;j<newEnd;j++)owners[j]=owner;
      return {owners,matched,bounded:true};
    }
    const width=cols+1,cost=new Uint32Array((rows+1)*width);
    for(let i=0;i<=rows;i++)cost[i*width]=i;
    for(let j=0;j<=cols;j++)cost[j]=j;
    for(let i=1;i<=rows;i++)for(let j=1;j<=cols;j++)cost[i*width+j]=Math.min(cost[(i-1)*width+j-1]+(source[first+i-1]===target[first+j-1]?0:1),cost[(i-1)*width+j]+1,cost[i*width+j-1]+1);
    let i=rows,j=cols;
    while(i||j){
      const at=i*width+j;
      if(i&&j&&cost[at]===cost[(i-1)*width+j-1]+(source[first+i-1]===target[first+j-1]?0:1)){owners[first+j-1]=base.owners[first+i-1];if(source[first+i-1]===target[first+j-1]&&/\S/u.test(source[first+i-1]))matched++;i--;j--;}
      else if(i&&cost[at]===cost[(i-1)*width+j]+1)i--;
      else{owners[first+j-1]=insertionOwner(base,first+i,fallback,/\s/u.test(target[first+j-1]));j--;}
    }
    // Ownership must follow original word order even around ambiguous insertions.
    let previous=fallback;for(let at=0;at<owners.length;at++){owners[at]=Math.max(previous,owners[at]??previous);previous=owners[at];}
    return {owners,matched,bounded:false};
  }
  function correctionLine(record,original,indices,text,approximate){
    const same=entry=>Array.isArray(entry?.indices)&&entry.indices.length===indices.length&&entry.indices.every((index,at)=>index===indices[at]);
    // Keep the editing group stable when a deletion or a short correction
    // changes the text length used by the initial geometric grouping heuristic.
    const groups=(record.correctionGroups||[]).filter(entry=>!same(entry)),oldGroup=(original.correctionGroups||[]).find(same);
    if(text===layout(original,{indices}).text){if(oldGroup)groups.push({indices:[...oldGroup.indices]});}
    else groups.push({indices:[...indices]});
    if(groups.length)record.correctionGroups=groups;else if(Object.hasOwn(original,'correctionGroups'))record.correctionGroups=[];else delete record.correctionGroups;
    const entries=(record.correctionLines||[]).filter(entry=>!same(entry));
    const old=(original.correctionLines||[]).find(same);
    if(text===layout(original,{indices}).text){if(old)entries.push({...old,indices:[...old.indices],box:old.box?[...old.box]:old.box});}
    else if(approximate||old){
      const boxes=indices.map(index=>box(original.words[index]));
      if(boxes.every(Boolean))entries.push({indices:[...indices],text,box:[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))]});
    }
    if(entries.length)record.correctionLines=entries;else if(Object.hasOwn(original,'correctionLines'))record.correctionLines=[];else delete record.correctionLines;
  }
  function update(draft,page,line,value){
    const original=draft?.original?.[page],record=draft?.records?.[page];
    if(!original||!record||record.skipped)throw new RangeError('교정할 인식 페이지가 없습니다.');
    const indices=indicesOf(original,line);indicesOf(record,line);
    const text=normalize(value);if(text.length>MAX_LINE_LENGTH)throw new RangeError('한 글줄은 60,000자까지 수정할 수 있습니다.');
    const source=layout(original,line);
    if(text===source.text){for(const index of indices){record.words[index].text=original.words[index].text;if(Object.hasOwn(original.words[index],'separator'))record.words[index].separator=original.words[index].separator;else delete record.words[index].separator;}correctionLine(record,original,indices,text,false);return layout(record,line);}
    const base=units(original,indices),target=[...text],diff=matchOwners(base,target,indices[0]),owners=diff.owners,parts=new Map(indices.map(index=>[index,[]]));
    target.forEach((char,index)=>parts.get(owners[index]).push(char));
    indices.forEach((index,at)=>{
      const fragment=parts.get(index).join(''),word=record.words[index],old=original.words[index],last=at===indices.length-1;
      if(fragment===normalize(old.text)+(last?'':normalize(ending(old)))){word.text=old.text;if(Object.hasOwn(old,'separator'))word.separator=old.separator;else delete word.separator;return;}
      if(last){word.text=fragment;if(Object.hasOwn(old,'separator'))word.separator=old.separator;else delete word.separator;}
      else{const tail=fragment.match(/[\t \f\v\u00a0]+$/)?.[0]||'';word.text=fragment.slice(0,fragment.length-tail.length);word.separator=tail;}
    });
    const count=value=>[...String(value)].filter(char=>/\S/u.test(char)).length;
    const oldCount=count(source.text),newCount=count(text),expanded=indices.some(index=>count(record.words[index].text)>Math.max(count(original.words[index].text)*1.8,count(original.words[index].text)+4));
    correctionLine(record,original,indices,text,indices.length>1&&newCount>0&&(diff.bounded||diff.matched/Math.max(1,oldCount,newCount)<.45||expanded));
    return layout(record,line);
  }
  globalThis.PDFOCRLines=Object.freeze({group,layout,update});
})();
