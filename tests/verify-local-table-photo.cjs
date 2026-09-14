// Explicit, local-only photo check. No document image or OCR text is retained.
// Usage: node tests/verify-local-table-photo.cjs path/to/photo.jpg
// Optional expected signature: 5x4:20,13x7:79
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const input=process.argv[2],expected=process.argv[3];
if(!input||!fs.existsSync(input))throw new Error('검증할 로컬 이미지 파일 경로를 지정하세요.');
const python=`import sys, struct
from PIL import Image, ImageOps
image=ImageOps.exif_transpose(Image.open(sys.argv[1])).convert('RGBA')
image.thumbnail((1600,1600),Image.Resampling.LANCZOS)
sys.stdout.buffer.write(struct.pack('<II',*image.size))
sys.stdout.buffer.write(image.tobytes())
`;
const decoded=execFileSync('python',['-c',python,path.resolve(input)],{maxBuffer:1600*1600*4+1024,windowsHide:true});
const image={width:decoded.readUInt32LE(0),height:decoded.readUInt32LE(4),data:decoded.subarray(8)};
require('../src/ocr-tables.js');const timings=[];let result;
for(let sample=0;sample<5;sample++){result=globalThis.PDFOCRTables.detect(image);timings.push(result.metrics.elapsedMs);}
const signature=result.tables.map(table=>`${table.y.length-1}x${table.x.length-1}:${table.cells.length}`).join(',');
if(expected)assert.equal(signature,expected);
console.log(JSON.stringify({dimensions:[image.width,image.height],signature,tables:result.tables.map(table=>({rows:table.y.length-1,columns:table.x.length-1,cells:table.cells.length,box:table.box,merged:table.cells.filter(cell=>cell.rowSpan>1||cell.colSpan>1).map(cell=>({row:cell.row,column:cell.col,rows:cell.rowSpan,columns:cell.colSpan})),traceCount:table.trace?{horizontal:table.trace.horizontal.length,vertical:table.trace.vertical.length}:null})),milliseconds:timings,warnings:result.warnings},null,2));
