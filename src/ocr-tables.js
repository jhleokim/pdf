/* Bounded, local table geometry. This module never alters the source OCR words. */
(() => {
  'use strict';
  const LIMITS=Object.freeze({maxEdge:1600,maxCells:600,maxLines:80,maxTables:12,maxWords:20000});
  const ASSIGNMENT_REASONS=new Set(['crossing-word','outside-table','low-confidence','edited-cell-remapped','unrecognized-ink']);
  const now=()=>globalThis.performance?.now?.()??Date.now();
  const validBox=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]>=0&&b[1]>=0&&b[2]<=1&&b[3]<=1&&b[2]>b[0]&&b[3]>b[1];
  const area=b=>(b[2]-b[0])*(b[3]-b[1]);
  const overlap=(a,b)=>Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
  const unique=values=>[...new Set(values)];
  function checkWords(words){if(!Array.isArray(words)||words.length>LIMITS.maxWords)throw new RangeError('표 분석은 한 페이지의 인식 영역 20,000개까지 지원합니다. 영역을 좁혀 다시 시도하세요.');}
  function checkGrid(x,y){
    for(const points of [x,y])if(!Array.isArray(points)||points.length<2||points.some((v,i)=>!Number.isFinite(v)||v<0||v>1||i>0&&v-points[i-1]<.00001))throw new RangeError('표 경계는 겹치지 않는 페이지 내부 좌표여야 합니다.');
    if(x.length+y.length>LIMITS.maxLines)throw new RangeError('표의 가로·세로 경계는 합계 80개까지 지원합니다. 표 영역을 나누세요.');
    if((x.length-1)*(y.length-1)>LIMITS.maxCells)throw new RangeError('표는 600칸까지 지원합니다. 표 영역을 나누세요.');
  }
  function cellAt(x,y,row,col,rowSpan=1,colSpan=1,reasons=[]){return {id:`r${row}c${col}`,row,col,rowSpan,colSpan,box:[x[col],y[row],x[col+colSpan],y[row+rowSpan]],wordIndices:[],text:'',needsReview:reasons.length>0,reasons:[...reasons]};}
  function cloneTable(table){
    checkGrid(table?.x,table?.y);
    if(!Array.isArray(table.cells)||table.cells.length>LIMITS.maxCells)throw new RangeError('표의 셀 정보가 올바르지 않습니다.');
    return {...table,x:[...table.x],y:[...table.y],box:[...table.box],cells:table.cells.map(cell=>({...cell,box:[...cell.box],wordIndices:[...cell.wordIndices||[]],reasons:[...cell.reasons||[]]})),unassignedIndices:[...table.unassignedIndices||[]],issues:[...table.issues||[]],resolvedIndices:[...table.resolvedIndices||[]],resolutions:(table.resolutions||[]).map(item=>({...item,box:[...item.box],cellIds:[...item.cellIds],cellTexts:[...item.cellTexts]}))};
  }
  function gridMap(table){
    const cols=table.x.length-1,rows=table.y.length-1,map=new Int32Array(cols*rows).fill(-1),ids=new Set();
    table.cells.forEach((cell,index)=>{
      const {row,col,rowSpan,colSpan}=cell;
      if(ids.has(cell.id)||![row,col,rowSpan,colSpan].every(Number.isInteger)||row<0||col<0||rowSpan<1||colSpan<1||row+rowSpan>rows||col+colSpan>cols)throw new RangeError('셀의 행·열 범위가 올바르지 않습니다.');
      ids.add(cell.id);
      for(let r=row;r<row+rowSpan;r++)for(let c=col;c<col+colSpan;c++){const at=r*cols+c;if(map[at]!==-1)throw new RangeError('표의 셀이 겹쳐 있습니다.');map[at]=index;}
    });
    if(map.some(value=>value<0))throw new RangeError('표에 빠진 셀이 있습니다.');
    return {cols,rows,map};
  }
  function interval(points,value){let lo=0,hi=points.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(points[mid]<=value)lo=mid;else hi=mid-1;}return Math.max(0,Math.min(points.length-2,lo));}
  function textForWords(words,indices){
    const source=[...indices].sort((a,b)=>a-b),punctuation=index=>/^[\p{P}\p{S}]+$/u.test(String(words[index].text??''));
    const position=(a,b)=>words[a].box[1]-words[b].box[1]||words[a].box[0]-words[b].box[0]||a-b;
    const sorted=source.filter(index=>!punctuation(index)).sort(position),lines=[],lineFor=new Map();
    function addRow(index){
      const b=words[index].box,previous=lines[lines.length-1],height=b[3]-b[1];
      if(previous&&Math.min(previous.bottom,b[3])-Math.max(previous.top,b[1])>=Math.min(previous.bottom-previous.top,height)*.45){previous.indices.push(index);previous.top=Math.min(previous.top,b[1]);previous.bottom=Math.max(previous.bottom,b[3]);lineFor.set(index,previous);}
      else{const line={top:b[1],bottom:b[3],indices:[index]};lines.push(line);lineFor.set(index,line);}
    }
    for(const index of sorted)addRow(index);
    // Vision gives punctuation its ink box: a comma can sit below the digit
    // baseline. Sorting those boxes into rows first can turn 1,250 into 1250\n,.
    // Establish full-height rows, then use adjacent source words as bounded
    // anchors. Source neighbors also avoid a quadratic punctuation/row search.
    const previous=new Map(),next=new Map(),glyphWidths=new Map();let anchor=null;
    for(const index of source){previous.set(index,anchor);if(!punctuation(index))anchor=index;}
    anchor=null;for(let at=source.length-1;at>=0;at--){const index=source[at];next.set(index,anchor);if(!punctuation(index))anchor=index;}
    function glyphWidth(index){if(!glyphWidths.has(index)){const b=words[index].box;glyphWidths.set(index,(b[2]-b[0])/Math.max(1,[...String(words[index].text??'')].length));}return glyphWidths.get(index);}
    function nearAnchor(index,anchorIndex){
      if(anchorIndex===null||anchorIndex===undefined)return false;
      const b=words[index].box,a=words[anchorIndex].box,height=a[3]-a[1],center=(b[1]+b[3])/2;
      if(center<a[1]-height*.15||center>a[3]+height*.25)return false;
      const gap=Math.max(0,a[0]-b[2],b[0]-a[2]);
      return gap<=Math.min(.018,Math.max(glyphWidth(anchorIndex),glyphWidth(index))*1.5);
    }
    const unanchored=[];
    for(const index of source.filter(punctuation)){
      const before=previous.get(index),after=next.get(index);
      const anchorIndex=nearAnchor(index,before)&&!/[\r\n]/.test(words[before].separator??'')?before:nearAnchor(index,after)?after:nearAnchor(index,before)?before:null;
      if(anchorIndex===null)unanchored.push(index);else lineFor.get(anchorIndex).indices.push(index);
    }
    // Standalone symbols retain their own rows; they must not join an unrelated
    // text row merely because that row happens to be vertically nearby.
    const anchored=lines.splice(0);for(const index of unanchored.sort(position))addRow(index);lines.push(...anchored);
    return lines.sort((a,b)=>a.top-b.top||words[a.indices[0]].box[0]-words[b.indices[0]].box[0]).map(line=>line.indices.sort((a,b)=>words[a].box[0]-words[b].box[0]||a-b).map((index,at,all)=>String(words[index].text??'')+(at===all.length-1?'':String(words[index].separator??' '))).join('').replace(/[ \t\r\n]+$/u,'')).join('\n');
  }
  function refresh(table,words=[]){
    checkWords(words);const result=cloneTable(table),{cols,map}=gridMap(result),oldIndices=result.cells.map(cell=>cell.wordIndices.join(','));
    const snapshot=value=>JSON.stringify({x:value.x,y:value.y,cells:value.cells.map(cell=>[cell.id,cell.box,cell.wordIndices,cell.text,cell.reasons]),unassigned:value.unassignedIndices,resolved:value.resolvedIndices||[],resolutions:value.resolutions||[]}),before=snapshot(table);
    result.unassignedIndices=[];
    for(const cell of result.cells){cell.box=[result.x[cell.col],result.y[cell.row],result.x[cell.col+cell.colSpan],result.y[cell.row+cell.rowSpan]];cell.wordIndices=[];cell.reasons=cell.reasons.filter(reason=>!ASSIGNMENT_REASONS.has(reason));}
    for(let index=0;index<words.length;index++){
      const word=words[index],b=word?.box;if(!validBox(b)||!overlap(b,result.box))continue;
      const wordArea=area(b),tableRatio=overlap(b,result.box)/wordArea;if(tableRatio<.05)continue;
      const c0=interval(result.x,Math.max(b[0],result.box[0])),c1=interval(result.x,Math.min(b[2]-1e-10,result.box[2]-1e-10));
      const r0=interval(result.y,Math.max(b[1],result.box[1])),r1=interval(result.y,Math.min(b[3]-1e-10,result.box[3]-1e-10));
      const candidates=new Set();for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)candidates.add(map[r*cols+c]);
      const scored=[];for(const cellIndex of candidates){const ratio=overlap(b,result.cells[cellIndex].box)/wordArea;if(ratio>1e-8)scored.push({cellIndex,ratio});}
      scored.sort((a,b)=>b.ratio-a.ratio);
      if(scored[0]?.ratio>=.85&&(scored[1]?.ratio??0)<=.10){
        const cell=result.cells[scored[0].cellIndex];cell.wordIndices.push(index);
        // Studio adapters normalize all engine confidences to 0–100.
        if(!word.corrected&&(word.uncertain||Number.isFinite(word.confidence)&&word.confidence<70))cell.reasons.push('low-confidence');
      }else{
        result.unassignedIndices.push(index);const reason=tableRatio<.85?'outside-table':'crossing-word';
        for(const item of scored)result.cells[item.cellIndex].reasons.push(reason);
      }
    }
    result.cells.forEach((cell,index)=>{
      if(cell.edited===true){if(oldIndices[index]!==cell.wordIndices.join(',')||table.cells[index]?.reasons?.includes('edited-cell-remapped'))cell.reasons.push('edited-cell-remapped');}
      else cell.text=textForWords(words,cell.wordIndices);
      if(!String(cell.text).trim()&&validBox(cell.inkBox)&&overlap(cell.box,cell.inkBox)>0)cell.reasons.push('unrecognized-ink');
      cell.reasons=unique(cell.reasons);cell.needsReview=cell.reasons.length>0;
    });
    result.issues=unique(result.issues.filter(reason=>!ASSIGNMENT_REASONS.has(reason)).concat(result.cells.flatMap(cell=>cell.reasons)));
    result.resolutions=result.resolutions.filter(item=>{
      const word=words[item.index];if(!result.unassignedIndices.includes(item.index)||!word||item.text!==String(word.text??'')||JSON.stringify(item.box)!==JSON.stringify(word.box))return false;
      const affected=result.cells.filter(cell=>overlap(cell.box,word.box)>0);
      return JSON.stringify(item.cellIds)===JSON.stringify(affected.map(cell=>cell.id))&&JSON.stringify(item.cellTexts)===JSON.stringify(affected.map(cell=>cell.text));
    });
    result.resolvedIndices=result.resolutions.map(item=>item.index);
    result.reviewed=table.reviewed===true&&before===snapshot(result);
    return result;
  }
  function fromGrid({x,y,words=[]}){
    checkGrid(x,y);checkWords(words);const cells=[];
    for(let row=0;row<y.length-1;row++)for(let col=0;col<x.length-1;col++)cells.push(cellAt(x,y,row,col,1,1,['manual-grid']));
    return refresh({id:'table-manual',box:[x[0],y[0],x[x.length-1],y[y.length-1]],x:[...x],y:[...y],cells,unassignedIndices:[],issues:['manual-grid'],reviewed:false},words);
  }
  function merge(table,cellIds,words=[]){
    const result=cloneTable(table);gridMap(result);
    if(!Array.isArray(cellIds)||new Set(cellIds).size<2)throw new RangeError('병합할 셀을 두 개 이상 선택하세요.');
    const selected=result.cells.filter(cell=>cellIds.includes(cell.id));if(selected.length!==new Set(cellIds).size)throw new RangeError('병합할 셀을 찾을 수 없습니다.');
    const row=Math.min(...selected.map(cell=>cell.row)),col=Math.min(...selected.map(cell=>cell.col)),bottom=Math.max(...selected.map(cell=>cell.row+cell.rowSpan)),right=Math.max(...selected.map(cell=>cell.col+cell.colSpan));
    if(selected.reduce((sum,cell)=>sum+cell.rowSpan*cell.colSpan,0)!==(bottom-row)*(right-col))throw new RangeError('직사각형으로 이어진 셀만 병합할 수 있습니다.');
    const cell=cellAt(result.x,result.y,row,col,bottom-row,right-col,unique(selected.flatMap(item=>item.reasons).filter(reason=>!['manual-grid','inferred-merge'].includes(reason))));
    const inkBoxes=selected.map(item=>item.inkBox).filter(validBox);if(inkBoxes.length)cell.inkBox=[Math.min(...inkBoxes.map(b=>b[0])),Math.min(...inkBoxes.map(b=>b[1])),Math.max(...inkBoxes.map(b=>b[2])),Math.max(...inkBoxes.map(b=>b[3]))];
    if(selected.some(item=>item.edited===true)){cell.edited=true;cell.text=selected.sort((a,b)=>a.row-b.row||a.col-b.col).map(item=>item.text).filter(Boolean).join('\n');cell.wordIndices=selected.flatMap(item=>item.wordIndices);}
    result.cells=result.cells.filter(item=>!cellIds.includes(item.id)).concat(cell).sort((a,b)=>a.row-b.row||a.col-b.col);result.reviewed=false;result.resolutions=[];result.resolvedIndices=[];result.issues=[];return refresh(result,words);
  }
  function split(table,cellId,words=[]){
    const result=cloneTable(table),cell=result.cells.find(item=>item.id===cellId);if(!cell)throw new RangeError('나눌 셀을 찾을 수 없습니다.');
    if(cell.rowSpan===1&&cell.colSpan===1)throw new RangeError('병합된 셀만 나눌 수 있습니다.');
    // An edited sentence has no reliable per-cell geometry. Never divide it by character count.
    if(cell.edited===true)throw new RangeError('수정한 병합 셀은 텍스트를 보관한 뒤 인식 내용으로 되돌려야 나눌 수 있습니다.');
    result.cells=result.cells.filter(item=>item.id!==cellId);
    for(let row=cell.row;row<cell.row+cell.rowSpan;row++)for(let col=cell.col;col<cell.col+cell.colSpan;col++){const child=cellAt(result.x,result.y,row,col);if(validBox(cell.inkBox)&&overlap(child.box,cell.inkBox)>0)child.inkBox=[...cell.inkBox];result.cells.push(child);}
    result.cells.sort((a,b)=>a.row-b.row||a.col-b.col);result.reviewed=false;result.resolutions=[];result.resolvedIndices=[];result.issues=[];return refresh(result,words);
  }
  function moveBoundary(table,axis,index,value,words=[]){
    const result=cloneTable(table);if(!['x','y'].includes(axis)||!Number.isInteger(index)||index<0||index>=result[axis].length||!Number.isFinite(value)||value<0||value>1)throw new RangeError('옮길 표 경계가 올바르지 않습니다.');
    result[axis][index]=value;checkGrid(result.x,result.y);result.box=[result.x[0],result.y[0],result.x[result.x.length-1],result.y[result.y.length-1]];result.reviewed=false;result.resolutions=[];result.resolvedIndices=[];return refresh(result,words);
  }
  function resolveWord(table,index,words=[]){
    const result=refresh(table,words),word=words[index];
    if(!Number.isInteger(index)||!result.unassignedIndices.includes(index)||!validBox(word?.box))throw new RangeError('확인할 미배치 인식 영역을 찾을 수 없습니다.');
    const affected=result.cells.filter(cell=>overlap(cell.box,word.box)>0);
    result.resolutions=result.resolutions.filter(item=>item.index!==index).concat({index,text:String(word.text??''),box:[...word.box],cellIds:affected.map(cell=>cell.id),cellTexts:affected.map(cell=>cell.text)});
    result.resolvedIndices=result.resolutions.map(item=>item.index);result.reviewed=false;return result;
  }
  function unresolveWord(table,index){const result=cloneTable(table);result.resolutions=result.resolutions.filter(item=>item.index!==index);result.resolvedIndices=result.resolutions.map(item=>item.index);result.reviewed=false;return result;}
  const escapeHTML=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function safeSpreadsheetText(value){
    const text=String(value??'').replace(/\u0000/g,'');
    // Quoting TSV alone does not prevent spreadsheet formulas. Prefix an apostrophe
    // before formula starters (including after whitespace). Preserve numeric negatives.
    return /^[\s\u0001-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\uFEFF]*[=+@-]/u.test(text)&&!/^\s*-?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)\s*$/u.test(text)?"'"+text:text;
  }
  function exportable(table){checkGrid(table?.x,table?.y);gridMap(table);if(table.unassignedIndices?.some(index=>!table.resolvedIndices?.includes(index)))throw new RangeError('칸을 가로지르거나 표 밖으로 걸친 인식 영역이 남아 있습니다. 경계를 조정하거나 해당 글줄을 각 칸에 반영했는지 확인한 뒤 복사하세요.');}
  function toTSV(table){
    exportable(table);const matrix=Array.from({length:table.y.length-1},()=>Array(table.x.length-1).fill(''));
    for(const cell of table.cells){const text=safeSpreadsheetText(cell.text);matrix[cell.row][cell.col]=/[\t\r\n"]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;}
    return matrix.map(row=>row.join('\t')).join('\r\n');
  }
  function toHTML(table){
    exportable(table);const rows=Array.from({length:table.y.length-1},()=>[]);
    for(const cell of [...table.cells].sort((a,b)=>a.row-b.row||a.col-b.col))rows[cell.row].push(`<td rowspan="${cell.rowSpan}" colspan="${cell.colSpan}" style="mso-number-format:'\\@';white-space:pre-wrap">${escapeHTML(safeSpreadsheetText(cell.text)).replace(/\r\n|\r|\n/g,'<br>')}</td>`);
    return '<table><tbody>'+rows.map(row=>'<tr>'+row.join('')+'</tr>').join('')+'</tbody></table>';
  }
  function rasterMask(image){
    const {width,height,data}=image,n=width*height,stride=width+1,gray=new Uint8Array(n),sum=new Uint32Array((width+1)*(height+1));
    for(let y=0;y<height;y++){let row=0;for(let x=0;x<width;x++){const at=y*width+x,alpha=data[at*4+3]/255,g=Math.round((data[at*4]*.299+data[at*4+1]*.587+data[at*4+2]*.114)*alpha+255*(1-alpha));gray[at]=g;row+=g;sum[(y+1)*stride+x+1]=sum[y*stride+x+1]+row;}}
    const mask=new Uint8Array(n),radius=15;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const l=Math.max(0,x-radius),r=Math.min(width,x+radius+1),t=Math.max(0,y-radius),b=Math.min(height,y+radius+1),mean=(sum[b*stride+r]-sum[t*stride+r]-sum[b*stride+l]+sum[t*stride+l])/((r-l)*(b-t));
      if(gray[y*width+x]<mean-12&&gray[y*width+x]<235)mask[y*width+x]=1;
    }
    return mask;
  }
  function runs(mask,width,height,region,horizontal){
    const across0=horizontal?region[0]:region[1],across1=horizontal?region[2]:region[3],along0=horizontal?region[1]:region[0],along1=horizontal?region[3]:region[2];
    const minimum=horizontal?Math.max(24,Math.round((across1-across0)*.025)):Math.max(14,Math.round((across1-across0)*.012));
    const found=[],groups=[],maxGap=Math.max(2,Math.round(Math.max(width,height)*.004));
    for(let coordinate=along0;coordinate<along1;coordinate++){
      let start=-1,last=-1,count=0;
      const flush=()=>{if(start>=0&&last-start+1>=minimum&&count/(last-start+1)>=.90){found.push({coordinate,start,end:last});if(found.length>40000)throw new RangeError('표 경계 후보가 너무 많습니다. 표 영역을 좁혀 다시 분석하세요.');}start=-1;count=0;};
      for(let point=across0;point<across1;point++){
        const black=mask[horizontal?coordinate*width+point:point*width+coordinate];
        if(black){if(start<0)start=point;last=point;count++;}else if(start>=0&&point-last>maxGap)flush();
      }
      flush();
    }
    // Coalesce the thickness of one ruled line, but do not bridge nearby columns.
    let active=[],lastCoordinate=-1;
    for(const run of found){
      if(run.coordinate!==lastCoordinate){active=active.filter(group=>run.coordinate-group.last<=2);lastCoordinate=run.coordinate;}
      let match=null;
      for(let i=active.length-1;i>=0;i--){const g=active[i],common=Math.min(g.end,run.end)-Math.max(g.start,run.start)+1;if(common>=Math.min(g.end-g.start+1,run.end-run.start+1)*.7){match=g;break;}}
      if(match){match.last=run.coordinate;match.sum+=run.coordinate;match.count++;match.start=Math.min(match.start,run.start);match.end=Math.max(match.end,run.end);}
      else{const group={...run,last:run.coordinate,sum:run.coordinate,count:1};groups.push(group);active.push(group);if(groups.length>2400)throw new RangeError('표 경계 후보가 너무 많습니다. 표 영역을 좁혀 다시 분석하세요.');}
    }
    return groups.map(g=>({coordinate:g.sum/g.count,start:g.start,end:g.end}));
  }
  function cluster(values,tolerance=3){const sorted=[...values].sort((a,b)=>a-b),groups=[];for(const value of sorted){const group=groups[groups.length-1];if(group&&value-group[group.length-1]<=tolerance)group.push(value);else groups.push([value]);}return groups.map(group=>group.reduce((a,b)=>a+b,0)/group.length);}
  function boundarySupport(segments,coordinate,start,end){
    // Text strokes near an absent border are not a border. Require a straight
    // segment touching a cell boundary, or spanning most of its interior.
    const intervals=segments.filter(line=>Math.abs(line.coordinate-coordinate)<=2.5&&line.end>start+2&&line.start<end-2&&(line.start<=start+3||line.end>=end-3||line.end-line.start>=(end-start)*.45)).map(line=>[Math.max(start,line.start),Math.min(end,line.end)]).sort((a,b)=>a[0]-b[0]);
    let covered=0,last=start;for(const [a,b] of intervals){if(b>last){covered+=b-Math.max(a,last);last=b;}}
    return covered/Math.max(1,end-start);
  }
  function componentTable(xs,ys,hs,vs,width,height,words,id){
    const x=xs.map(v=>v/width),y=ys.map(v=>v/height);checkGrid(x,y);
    const cols=x.length-1,rows=y.length-1,vertical=Array.from({length:rows},()=>[]),horizontal=Array.from({length:rows+1},()=>[]);
    const state=score=>score>=.86?1:score<=.12?0:2;
    for(let r=0;r<rows;r++)for(let c=0;c<=cols;c++)vertical[r][c]=state(boundarySupport(vs,xs[c],ys[r],ys[r+1]));
    for(let r=0;r<=rows;r++)for(let c=0;c<cols;c++)horizontal[r][c]=state(boundarySupport(hs,ys[r],xs[c],xs[c+1]));
    if(vertical.some(row=>row[0]!==1||row[cols]!==1)||horizontal[0].some(v=>v!==1)||horizontal[rows].some(v=>v!==1))return null;
    const parents=Array.from({length:rows*cols},(_,index)=>index),find=index=>{while(parents[index]!==index){parents[index]=parents[parents[index]];index=parents[index];}return index;},union=(a,b)=>{parents[find(a)]=find(b);};
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){if(c<cols-1&&vertical[r][c+1]===0)union(r*cols+c,r*cols+c+1);if(r<rows-1&&horizontal[r+1][c]===0)union(r*cols+c,(r+1)*cols+c);}
    const groups=new Map();for(let index=0;index<rows*cols;index++){const root=find(index);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(index);}
    const cells=[],issues=[];
    for(const indices of groups.values()){
      const top=Math.min(...indices.map(index=>Math.floor(index/cols))),bottom=Math.max(...indices.map(index=>Math.floor(index/cols)))+1,left=Math.min(...indices.map(index=>index%cols)),right=Math.max(...indices.map(index=>index%cols))+1;
      let rectangular=(bottom-top)*(right-left)===indices.length;
      if(rectangular)for(let r=top;r<bottom;r++)for(let c=left;c<right;c++)if(c<right-1&&vertical[r][c+1]!==0||r<bottom-1&&horizontal[r+1][c]!==0)rectangular=false;
      if(rectangular){const reasons=[];if(indices.length>1)reasons.push('inferred-merge');for(let r=top;r<bottom;r++)if(vertical[r][left]===2||vertical[r][right]===2)reasons.push('ambiguous-border');for(let c=left;c<right;c++)if(horizontal[top][c]===2||horizontal[bottom][c]===2)reasons.push('ambiguous-border');cells.push(cellAt(x,y,top,left,bottom-top,right-left,unique(reasons)));}
      else{issues.push('nonrectangular-merge');for(const index of indices)cells.push(cellAt(x,y,Math.floor(index/cols),index%cols,1,1,['nonrectangular-merge']));}
    }
    cells.sort((a,b)=>a.row-b.row||a.col-b.col);
    return refresh({id,box:[x[0],y[0],x[x.length-1],y[y.length-1]],x,y,cells,unassignedIndices:[],issues:unique(issues),reviewed:false},words);
  }
  function fragmentRisk(table,hs,vs,width,height){
    const tolerance=Math.max(6,Math.max(width,height)*.006);
    for(const [points,bounds,segments] of [[table.y.map(v=>v*height),[table.box[0]*width,table.box[2]*width],hs],[table.x.map(v=>v*width),[table.box[1]*height,table.box[3]*height],vs]]){
      let before=0,after=0;
      for(const point of points){
        const matching=segments.filter(line=>Math.abs(line.coordinate-point)<=3&&Math.min(line.end,bounds[1])-Math.max(line.start,bounds[0])>(bounds[1]-bounds[0])*.6);
        if(matching.some(line=>line.start<bounds[0]-tolerance))before++;
        if(matching.some(line=>line.end>bounds[1]+tolerance))after++;
      }
      // Repeated overhanging rules indicate that only part of a larger grid was
      // closed. Do not quietly export the surviving columns and omit the gap.
      if(before>=2||after>=2)return true;
    }
    return false;
  }
  function markUnrecognizedInk(table,mask,width,height){
    const inset=Math.max(3,Math.ceil(Math.max(width,height)*.003));
    for(const cell of table.cells){
      if(String(cell.text).trim()||cell.reasons.includes('crossing-word')||cell.reasons.includes('outside-table'))continue;
      const l=Math.max(0,Math.ceil(cell.box[0]*width)+inset),r=Math.min(width,Math.floor(cell.box[2]*width)-inset),t=Math.max(0,Math.ceil(cell.box[1]*height)+inset),b=Math.min(height,Math.floor(cell.box[3]*height)-inset);
      if(r-l<5||b-t<5)continue;
      let pixels=0,minX=r,minY=b,maxX=l,maxY=t;
      for(let y=t;y<b;y++)for(let x=l;x<r;x++)if(mask[y*width+x]){pixels++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
      // This is a review signal, not OCR: a visible mark might also be a stamp,
      // signature or decoration. Tiny dust and a thin isolated rule are ignored.
      if(pixels>=Math.max(14,(r-l)*(b-t)*.0015)&&maxX-minX>=4&&maxY-minY>=4){
        cell.inkBox=[minX/width,minY/height,(maxX+1)/width,(maxY+1)/height];cell.reasons=unique([...cell.reasons,'unrecognized-ink']);cell.needsReview=true;
      }
    }
    if(table.cells.some(cell=>cell.reasons.includes('unrecognized-ink')))table.issues=unique([...table.issues,'unrecognized-ink']);
  }
  function detect(image,{region,words=[]}={}){
    const started=now(),metrics={width:image?.width??0,height:image?.height??0,wordCount:Array.isArray(words)?words.length:0,lineCandidates:0,cells:0,elapsedMs:0},warnings=[];
    const finish=tables=>({tables,warnings,metrics:{...metrics,elapsedMs:Math.round((now()-started)*10)/10}});
    try{
      checkWords(words);const {width,height,data}=image||{};
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxEdge||height>LIMITS.maxEdge||!data||data.length!==width*height*4)throw new RangeError('표 분석 이미지는 긴 변 1,600픽셀 이하의 RGBA 이미지여야 합니다.');
      if(region&&!validBox(region))throw new RangeError('표 분석 영역이 올바르지 않습니다.');
      const rect=region?[Math.floor(region[0]*width),Math.floor(region[1]*height),Math.ceil(region[2]*width),Math.ceil(region[3]*height)]:[0,0,width,height];
      const mask=rasterMask(image),hs=runs(mask,width,height,rect,true),vs=runs(mask,width,height,rect,false);metrics.lineCandidates=hs.length+vs.length;
      if(hs.length*vs.length>2000000)throw new RangeError('표 경계의 교차 후보가 너무 많습니다. 표 영역을 좁혀 다시 분석하세요.');
      const adjacency=Array.from({length:hs.length+vs.length},()=>[]),tolerance=3;
      for(let hi=0;hi<hs.length;hi++)for(let vi=0;vi<vs.length;vi++){const h=hs[hi],v=vs[vi];if(h.coordinate>=v.start-tolerance&&h.coordinate<=v.end+tolerance&&v.coordinate>=h.start-tolerance&&v.coordinate<=h.end+tolerance){adjacency[hi].push(hs.length+vi);adjacency[hs.length+vi].push(hi);}}
      const seen=new Set(),tables=[];let rejected=0;
      for(let first=0;first<adjacency.length;first++){
        if(seen.has(first)||adjacency[first].length<2)continue;
        const queue=[first],h=[],v=[];seen.add(first);
        for(let at=0;at<queue.length;at++){const index=queue[at];if(index<hs.length)h.push(hs[index]);else v.push(vs[index-hs.length]);for(const next of adjacency[index])if(!seen.has(next)&&adjacency[next].length>=2){seen.add(next);queue.push(next);}}
        const xs=cluster(v.map(line=>line.coordinate)),ys=cluster(h.map(line=>line.coordinate));
        if(xs.length<2||ys.length<2||(xs.length-1)*(ys.length-1)<2)continue;
        if(xs.some((value,i)=>i&&value-xs[i-1]<6)||ys.some((value,i)=>i&&value-ys[i-1]<6)){rejected++;continue;}
        const table=componentTable(xs,ys,hs,vs,width,height,words,`table-${tables.length+1}`);
        if(!table){rejected++;continue;}
        if(fragmentRisk(table,hs,vs,width,height)){rejected++;continue;}
        markUnrecognizedInk(table,mask,width,height);
        tables.push(table);metrics.cells+=(xs.length-1)*(ys.length-1);
        if(tables.length>LIMITS.maxTables)throw new RangeError('한 페이지에서 표 12개까지 분석합니다. 표 영역을 나누세요.');
        if(metrics.cells>LIMITS.maxCells)throw new RangeError('한 번에 표 600칸까지 분석합니다. 표 영역을 나누세요.');
      }
      if(!tables.length)warnings.push('수평·수직 테두리가 분명한 표를 찾지 못했습니다. 기울기와 흐린 경계를 확인하거나 표 영역과 행·열을 직접 지정하세요.');
      if(rejected)warnings.push('일부 표 후보의 경계가 끊기거나 기울어져 자동 구성을 보류했습니다. 해당 영역을 직접 지정하세요.');
      const invalid=words.filter(word=>!validBox(word?.box)).length;if(invalid)warnings.push(`위치 정보가 없는 인식 영역 ${invalid}개는 표에 배치하지 않았습니다. 기존 인식 텍스트에서 확인하세요.`);
      if(tables.some(table=>table.unassignedIndices.length))warnings.push('여러 칸에 걸친 인식 영역이 있습니다. 경계를 조정하거나 셀을 병합해야 표로 복사할 수 있습니다.');
      return finish(tables.sort((a,b)=>a.box[1]-b.box[1]||a.box[0]-b.box[0]));
    }catch(error){warnings.push(error instanceof RangeError?error.message:'표 구조를 안전하게 분석하지 못했습니다. 표 영역을 좁히거나 직접 지정하세요.');return finish([]);}
  }
  globalThis.PDFOCRTables=Object.freeze({detect,fromGrid,refresh,merge,split,moveBoundary,resolveWord,unresolveWord,toTSV,toHTML,textForWords,limits:LIMITS});
})();
