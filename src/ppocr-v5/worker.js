/* Classic Worker: the verified PP-OCRv5 engine uses WASM, never WebGPU. */
'use strict';
let engine, requestID = 0, phase = 'init';
const progress = (status, detail, value = 0) => postMessage({id: requestID, type: 'progress', progress: {status, detail, progress: Math.max(0, Math.min(1, value))}});

async function readAsset(name, urls, assets) {
  const expected = assets[name];
  if (!expected || !Number.isSafeInteger(expected.bytes) || expected.bytes <= 0 || expected.bytes > 25000000 || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw Error('Paddle 파일 정보가 올바르지 않습니다.');
  const url = urls[name];
  if (typeof url !== 'string' || !/^(https?:|blob:)/.test(url)) throw Error('Paddle 파일 주소가 올바르지 않습니다.');
  const response = await fetch(url, {credentials: 'omit'});
  if (!response.ok || !response.body) throw Error('Paddle 인식 데이터를 받지 못했습니다. 연결을 확인해 주세요.');
  const reader = response.body.getReader(), bytes = new Uint8Array(expected.bytes);
  let offset = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expected.bytes) {await reader.cancel(); throw Error('Paddle 인식 데이터 크기가 일치하지 않습니다.');}
      bytes.set(value, offset); offset += value.byteLength;
      progress('loading assets', (name === 'det.onnx' ? '글자 영역 모델' : name === 'rec.onnx' ? '한국어 인식 모델' : '문자 사전') + ' 준비 · ' + Math.round(offset / expected.bytes * 100) + '%', offset / expected.bytes);
    }
  } finally {reader.releaseLock();}
  if (offset !== expected.bytes) throw Error('Paddle 인식 데이터가 끝까지 도착하지 않았습니다.');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== expected.sha256) throw Error('Paddle 인식 데이터가 손상됐습니다. 페이지를 새로 열어 주세요.');
  return bytes;
}

onmessage = async ({data}) => {
  requestID = data.id; phase = data.type;
  try {
    if (data.type === 'init') {
      progress('preparing engine', 'Paddle 경량 엔진 준비');
      const {urls, assets} = data;
      importScripts(urls['ort.js'], urls['opencv.js'], urls['engine.js']);
      ort.env.wasm.wasmPaths = {mjs: urls['ort-wasm-simd-threaded.mjs'], wasm: urls['ort-wasm-simd-threaded.wasm']};
      engine = await createPPV5({asset: name => readAsset(name, urls, assets), onProgress: (label, value) => progress(phase === 'init' ? 'preparing engine' : 'recognizing text', label, phase === 'init' ? 0 : .1 + .89 * (value || 0))});
      postMessage({id: data.id, type: 'result', result: {ready: true}});
    } else if (data.type === 'recognize') {
      if (!engine || !Number.isSafeInteger(data.width) || !Number.isSafeInteger(data.height) || data.width < 1 || data.height < 1 || data.width * data.height > 6000000 || data.pixels?.byteLength !== data.width * data.height * 4) throw Error('인식할 페이지 데이터가 올바르지 않습니다.');
      const canvas = new OffscreenCanvas(data.width, data.height);
      try {
        canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height), 0, 0);
        const result = await engine.recognize(canvas, {size: 1536});
        progress('recognizing text', '글줄 인식 완료', 1);
        postMessage({id: data.id, type: 'result', result});
      } finally {canvas.width = canvas.height = 0;}
    } else throw Error('알 수 없는 Paddle 작업입니다.');
  } catch (error) {postMessage({id: data.id, type: 'error', error: {message: error.message, code: error.code || 'PPV5_FAILED'}});}
};
