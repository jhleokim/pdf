/* Reversible table topology edits. Original OCR records and pixels stay intact. */
(() => {
  'use strict';
  const geometry=()=>globalThis.PDFOCRTables;
  const axisKeys=axis=>axis==='x'?['col','colSpan']:axis==='y'?['row','rowSpan']:(()=>{throw new RangeError('행 또는 열을 선택하세요.');})();
  function draft(table,words){return structuredClone(geometry().refresh(table,words));}
  function band(table,axis,index){
    axisKeys(axis);
    if(!Number.isInteger(index)||index<0||index>=table[axis].length-1)throw new RangeError('편집할 행·열을 선택하세요.');
  }
  function finish(table,words){
    table.box=[table.x[0],table.y[0],table.x.at(-1),table.y.at(-1)];
    table.cells.sort((a,b)=>a.row-b.row||a.col-b.col);
    for(const cell of table.cells){cell.id=`r${cell.row}c${cell.col}`;cell.reasons=[...new Set([...(cell.reasons||[]),'manual-grid'])];}
    table.reviewed=false;table.resolvedIndices=[];table.resolutions=[];delete table.trace;
    return geometry().refresh(table,words);
  }
  function addBoundary(table,axis,index){
    const [start,span]=axisKeys(axis),at=index+1,value=(table[axis][index]+table[axis][at])/2;
    if(value-table[axis][index]<.00001||table[axis][at]-value<.00001)throw new RangeError('간격이 너무 좁습니다. 원본에서 경계를 먼저 넓혀 주세요.');
    table[axis].splice(at,0,value);
    for(const cell of table.cells){if(cell[start]>=at)cell[start]++;else if(cell[start]+cell[span]>=at)cell[span]++;}
    return at;
  }
  function pieces(cell,axis,at){
    const [start,span]=axisKeys(axis),end=cell[start]+cell[span];
    if(at<=cell[start]||at>=end)throw new RangeError('셀 내부의 경계를 선택하세요.');
    const first=structuredClone(cell),second=structuredClone(cell);
    first[span]=at-cell[start];second[start]=at;second[span]=end-at;
    for(const child of [first,second]){child.text='';child.wordIndices=[];delete child.edited;}
    return [first,second];
  }
  function insertBand(table,axis,index,words=[]){
    const result=draft(table,words);band(result,axis,index);
    const [start,span]=axisKeys(axis),cutIds=new Set(result.cells.filter(cell=>cell[start]===index&&cell[span]===1&&!cell.edited).map(cell=>cell.id));
    const at=addBoundary(result,axis,index);
    // Existing merged or manually corrected content stays whole. New geometry
    // may split source OCR words, which the shared engine flags as unassigned.
    result.cells=result.cells.flatMap(cell=>cutIds.has(cell.id)?pieces(cell,axis,at):[cell]);
    return finish(result,words);
  }
  function splitCell(table,cellId,axis,words=[]){
    const result=draft(table,words),[start,span]=axisKeys(axis),cell=result.cells.find(cell=>cell.id===cellId);
    if(!cell)throw new RangeError('나눌 셀을 선택하세요.');
    if(cell.edited)throw new RangeError('수정한 내용을 보관한 뒤 셀 원문을 복원해야 나눌 수 있습니다.');
    const at=cell[span]>1?cell[start]+Math.ceil(cell[span]/2):addBoundary(result,axis,cell[start]);
    result.cells=result.cells.flatMap(item=>item===cell?pieces(item,axis,at):[item]);
    return finish(result,words);
  }
  function deleteBand(table,axis,index,words=[]){
    const result=draft(table,words);band(result,axis,index);
    const count=result[axis].length-1,[start,span]=axisKeys(axis);
    if(count<=1)throw new RangeError('마지막 행·열은 삭제할 수 없습니다. 표 삭제를 사용하세요.');
    const removed=result.cells.filter(cell=>cell[start]===index&&cell[span]===1);
    const excluded=new Set(result.excludedWordIndices||[]);
    for(const cell of removed)for(const wordIndex of cell.wordIndices)excluded.add(wordIndex);
    result.excludedWordIndices=[...excluded].sort((a,b)=>a-b);
    // Keep the last deletion's values for inspection alongside the undo snapshot.
    // This is not a change to the page's OCR record or searchable PDF layer.
    result.deletedCells=removed.map(cell=>({row:cell.row,col:cell.col,rowSpan:cell.rowSpan,colSpan:cell.colSpan,text:cell.text,box:[...cell.box],wordIndices:[...cell.wordIndices]}));
    result.cells=result.cells.filter(cell=>!removed.includes(cell));
    for(const cell of result.cells){
      if(cell[start]>index)cell[start]--;
      else if(cell[start]<=index&&cell[start]+cell[span]>index){
        cell[span]--;
        // A merged heading crossing the removed band must not lose its text.
        // Changed source membership remains a visible review condition.
        if(cell.text){cell.edited=true;cell.reasons=[...new Set([...(cell.reasons||[]),'edited-cell-remapped'])];}
      }
    }
    result[axis].splice(index===0?0:index===count-1?count:index,1);
    return finish(result,words);
  }
  globalThis.PDFOCRTableEdit=Object.freeze({insertBand,deleteBand,splitCell});
})();
