const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {webcrypto, createHash} = require('node:crypto');
const {MODEL, normalizeResult, createSession} = require('../src/ppocr-v5/adapter.js');

const rawResult = () => ({width: 1000, height: 2000, words: [{text: '확인 문구', confidence: .93, box: [.1, .2, .4, .3], quad: [[100, 400], [400, 400], [400, 600], [100, 600]]}], elapsedMs: 123, detected: 1, columns: 1});
const canvas = () => ({width: 2, height: 3, getContext: () => ({getImageData: () => ({width: 2, height: 3, data: new Uint8ClampedArray(24)})})});
function workerFactory({initialize = true} = {}) {
  const workers = [];
  class WorkerImpl {
    constructor(url) {this.url = url; this.messages = []; this.terminated = 0; workers.push(this);}
    postMessage(data, transfer) {
      this.messages.push({data, transfer});
      if (data.type === 'init' && initialize) queueMicrotask(() => this.emit({id: data.id, type: 'result', result: {ready: true}}));
    }
    emit(data) {this.onmessage?.({data});}
    terminate() {this.terminated++;}
  }
  return {WorkerImpl, workers, options: {WorkerImpl, urls: {'worker.js': 'blob:local-worker'}, initTimeout: 200, pageTimeout: 200}};
}

test('line results preserve normalized page geometry and confidence for editor/export', () => {
  const result = normalizeResult(rawResult());
  assert.equal(result.model, MODEL);
  assert.equal(result.source, 'paddle-v5');
  assert.equal(result.status, 'complete');
  assert.equal(result.words[0].confidence, 93);
  assert.deepEqual(result.words[0].box, [.1, .2, .4, .3]);
  assert.deepEqual(result.words[0].quad, [[.1, .2], [.4, .2], [.4, .3], [.1, .3]]);
  assert.equal(result.words[0].separator, '\n');
  assert.equal(result.text, '확인 문구');
  const second = rawResult(); second.words.push({...second.words[0], text: '다음 줄', confidence: .45});
  assert.equal(normalizeResult(second).text, '확인 문구\n다음 줄');
  assert.equal(normalizeResult(second).words[1].uncertain, true);
});

test('invalid geometry never becomes a searchable-PDF record', () => {
  for (const box of [[.2, .2, .1, .3], [.1, NaN, .2, .3], [1.1, .1, 1.2, .2], [.1, .2]]) {
    const raw = rawResult(); raw.words[0].box = box;
    assert.throws(() => normalizeResult(raw), /위치/);
  }
  const empty = rawResult(); empty.words = [];
  assert.equal(normalizeResult(empty).canEmbed, false);
});

test('abort terminates active inference immediately and ignores its late result', async () => {
  const {workers, options} = workerFactory(), controller = new AbortController();
  const session = await createSession(controller.signal, null, options), worker = workers[0];
  const pending = session.recognize(canvas());
  const recognize = worker.messages.at(-1);
  assert.equal(recognize.transfer[0], recognize.data.pixels);
  controller.abort(new DOMException('사용자 취소', 'AbortError'));
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(worker.terminated, 1);
  worker.emit({id: recognize.data.id, type: 'result', result: rawResult()});
  await assert.rejects(session.recognize(canvas()), {name: 'AbortError'});
  await session.close(); assert.equal(worker.terminated, 1);
});

test('abort also cancels model initialization', async () => {
  const {workers, options} = workerFactory({initialize: false}), controller = new AbortController();
  const pending = createSession(controller.signal, null, options);
  controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(workers[0].terminated, 1);
});

test('a hard page deadline is not extended by repeated progress events', async () => {
  const {workers, options} = workerFactory();
  const session = await createSession(null, null, {...options, pageTimeout: 25}), worker = workers[0];
  const pending = session.recognize(canvas()), id = worker.messages.at(-1).data.id;
  const interval = setInterval(() => worker.emit({id, type: 'progress', progress: {progress: .5}}), 2);
  try {await assert.rejects(pending, {code: 'PPV5_TIMEOUT'});} finally {clearInterval(interval);}
  assert.equal(worker.terminated, 1);
});

test('matching response resolves one page; overlapping requests cannot replace it', async () => {
  const {workers, options} = workerFactory(), progress = [];
  const session = await createSession(null, event => progress.push(event), options), worker = workers[0];
  const pending = session.recognize(canvas()), id = worker.messages.at(-1).data.id;
  await assert.rejects(session.recognize(canvas()), /이전 페이지/);
  worker.emit({id: id - 1, type: 'error', error: {message: 'stale'}});
  worker.emit({id, type: 'progress', progress: {status: 'recognizing text', progress: .5}});
  worker.emit({id, type: 'result', result: rawResult()});
  assert.equal((await pending).text, '확인 문구');
  assert.equal(progress[0].progress, .5);
  await session.close(); assert.equal(worker.terminated, 1);
});

test('model bytes must match the manifest hash and declared size', async () => {
  const bytes = Buffer.from('model-fixture'), expected = {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  const sandbox = vm.createContext({onmessage: null, postMessage() {}, Uint8Array, crypto: webcrypto, fetch: async () => new Response(bytes)});
  vm.runInContext(readFileSync(require.resolve('../src/ppocr-v5/worker.js'), 'utf8'), sandbox);
  const readAsset = vm.runInContext('readAsset', sandbox);
  assert.equal(Buffer.from(await readAsset('det.onnx', {'det.onnx': 'blob:fixture'}, {'det.onnx': expected})).toString(), 'model-fixture');
  await assert.rejects(readAsset('det.onnx', {'det.onnx': 'blob:fixture'}, {'det.onnx': {...expected, sha256: '0'.repeat(64)}}), /손상/);
  await assert.rejects(readAsset('det.onnx', {'det.onnx': 'blob:fixture'}, {'det.onnx': {...expected, bytes: 2}}), /크기/);
  await assert.rejects(readAsset('det.onnx', {'det.onnx': 'blob:fixture'}, {'det.onnx': {...expected, bytes: 25000001}}), /정보/);
});
