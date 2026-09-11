// Independent Python/Pillow reference comparison; no browser or model execution.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {preprocessImageData,prefillPositionIds,generationPositionIds,parseSpotting} from './preprocess.mjs';

const input=JSON.parse(readFileSync(0,'utf8'));
const rgba=Buffer.from(input.rgba,'base64');
const referenceBytes=Buffer.from(input.reference,'base64');
const reference=new Float32Array(referenceBytes.buffer,referenceBytes.byteOffset,referenceBytes.byteLength/4);
const started=performance.now();
const actual=preprocessImageData({width:input.width,height:input.height,data:rgba},input.options);
assert.deepEqual([actual.resizedWidth,actual.resizedHeight],input.expectedSize);
assert.equal(actual.pixelValues.length,reference.length);
let unequalFloats=0,unequalBytes=0,absoluteSum=0,squaredSum=0,maxByteError=0,maxFloatError=0;
const histogram={};
for(let i=0;i<reference.length;i++){
  const floatError=Math.abs(actual.pixelValues[i]-reference[i]);
  if(floatError)unequalFloats++;
  maxFloatError=Math.max(maxFloatError,floatError);
  const a=Math.round((actual.pixelValues[i]+1)*127.5),b=Math.round((reference[i]+1)*127.5);
  const error=Math.abs(a-b);
  if(error)unequalBytes++;
  absoluteSum+=error;squaredSum+=error*error;maxByteError=Math.max(maxByteError,error);
  histogram[error]=(histogram[error]||0)+1;
}

// Hand-derived, non-square 2x3 merged grid: catches raster and 3-axis offsets.
const ids=[10,101305,...Array(6).fill(100295),101306,20,21];
const pos=prefillPositionIds(ids,[1,4,6]);
assert.deepEqual(Array.from(pos.positionIds,Number),[
  0,1,2,2,2,2,2,2,5,6,7,
  0,1,2,2,2,3,3,3,5,6,7,
  0,1,2,3,4,2,3,4,5,6,7,
]);
assert.equal(pos.ropeDelta,-3);
assert.equal(pos.nextPosition,8);
assert.deepEqual(Array.from(generationPositionIds(11,2,pos.ropeDelta),Number),[8,9,8,9,8,9]);
const loc='<|LOC_100|><|LOC_200|><|LOC_700|><|LOC_200|><|LOC_700|><|LOC_300|><|LOC_100|><|LOC_300|>';
const annotated=parseSpotting('<|TEXT_START|>한글 Test<|TEXT_END|><|LOC_BEGIN|>'+loc+'<|LOC_END|></s>');
assert.equal(annotated.text,'한글 Test');
assert.deepEqual(annotated.words[0].box,[.1,.2,.7,.3]);
assert.deepEqual(parseSpotting('한글 Test'+loc+'</s>').words,annotated.words);
assert.throws(()=>parseSpotting('한글 Test'+loc+'missing coordinates'));

process.stdout.write(JSON.stringify({name:input.name,source:[input.width,input.height],target:input.expectedSize,
  milliseconds:performance.now()-started,samples:reference.length,unequalFloats,unequalBytes,
  unequalBytePercent:100*unequalBytes/reference.length,meanAbsoluteByteError:absoluteSum/reference.length,
  rmsByteError:Math.sqrt(squaredSum/reference.length),maxByteError,maxFloatError,histogram,
  handDerivedMropeAndSpottingChecks:'passed'}));
