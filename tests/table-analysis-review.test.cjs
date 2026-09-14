'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/ocr-table-analysis.js'), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness() {
  const workers = [], canvases = [], urls = { created: [], revoked: [] };
  function canvas(width = 1, height = 1) {
    const result = { width, height, draws: [] };
    result.getContext = () => ({ fillRect() {}, drawImage(...args) { result.draws.push(args); },
      getImageData() { return { width: result.width, height: result.height, data: new Uint8ClampedArray(result.width * result.height * 4) }; } });
    canvases.push(result); return result;
  }
  class Worker {
    constructor(url) { this.url = url; this.terminated = false; workers.push(this); }
    postMessage(message, transfer) { this.message = structuredClone(message, { transfer }); this.transfers = transfer.length; }
    terminate() { this.terminated = true; }
    result(value) { this.onmessage({ data: { result: value } }); }
  }
  const context = vm.createContext({ AbortController, DOMException, performance, Uint8ClampedArray, Blob, Worker, setTimeout, clearTimeout,
    URL: { createObjectURL(blob) { const url = 'blob:test-' + urls.created.length; urls.created.push({ url, blob }); return url; }, revokeObjectURL(url) { urls.revoked.push(url); } },
    document: { getElementById: () => ({ textContent: '/* injected table algorithm */' }), createElement: () => canvas() }
  });
  vm.runInContext(source, context);
  return { api: context.PDFOCRTableAnalysis, canvas, canvases, workers, urls };
}

test('table worker bounds raster, transfers pixels once, and leaves original canvas intact', async () => {
  const h = harness(), original = h.canvas(3200, 4800);
  const pending = h.api.analyze(original, [{ text: '00123', box: [.1, .1, .2, .2] }]);
  const worker = h.workers[0];
  assert.equal(Math.max(worker.message.width, worker.message.height), 1600);
  assert.ok(worker.message.width * worker.message.height <= 1600 * 1600);
  assert.equal(worker.transfers, 1);
  assert.equal(worker.message.words[0].text, '00123');
  assert.equal(original.width, 3200); assert.equal(original.height, 4800);
  assert.equal(h.canvases.at(-1).width, 0);
  worker.result({ tables: [], warnings: [], metrics: { analysisMs: 10 } });
  const result = await pending;
  assert.equal(result.metrics.rasterBytes, worker.message.width * worker.message.height * 4);
  assert.equal(worker.terminated, true); assert.equal(h.urls.revoked[0], worker.url);
});

test('aborting analysis terminates worker and ignores late result before a fresh run', async () => {
  const h = harness(), controller = new AbortController(), original = h.canvas(100, 100);
  const pending = h.api.analyze(original, [], { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(h.workers[0].terminated, true);
  h.workers[0].result({ tables: [{ id: 'stale' }] });
  const next = h.api.analyze(original, []);
  h.workers[1].result({ tables: [{ id: 'fresh' }] });
  assert.equal((await next).tables[0].id, 'fresh');
});

test('cell recognition reuses one local model and limits crop size', async () => {
  const h = harness(), calls = []; let creates = 0, closes = 0;
  const reader = h.api.createCellReader(async () => { creates++; return {
    recognize: async canvas => { calls.push([canvas.width, canvas.height]); return { text: '1,250,000', confidence: 96 }; },
    close: async () => { closes++; }
  }; });
  const canvas = h.canvas(6000, 6000), record = { source: 'paddle-v5', language: 'kor+eng' };
  assert.equal((await reader.recognizeRegion(record, [0, 0, 1, 1], { canvas })).text, '1,250,000');
  await reader.recognizeRegion(record, [.2, .2, .3, .3], { canvas });
  assert.equal(creates, 1); assert.equal(closes, 0);
  assert.ok(calls[0][0] * calls[0][1] <= 4000000);
  assert.ok(Math.max(...calls[0]) <= 2367);
  await reader.close(); assert.equal(closes, 1);
  await assert.rejects(reader.recognizeRegion(record, [.1, .1, .2, .2], { canvas }), { name: 'AbortError' });
});

test('cancelled model initialization closes a late session and never recognizes a freed crop', async () => {
  const h = harness(), initialized = deferred(), initializationStarted = deferred(), controller = new AbortController(); let recognized = 0, closed = 0;
  const reader = h.api.createCellReader(() => { initializationStarted.resolve(); return initialized.promise; });
  const pending = reader.recognizeRegion({ source: 'paddle-v5' }, [.1, .1, .5, .5], { canvas: h.canvas(1200, 1500), signal: controller.signal });
  await initializationStarted.promise; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  initialized.resolve({ recognize: async () => { recognized++; return { text: 'late' }; }, close: async () => { closed++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(recognized, 0); assert.equal(closed, 1);
  await reader.close();
});

test('closing a reader rejects late recognition results even if an engine ignores abort', async () => {
  const h = harness(), recognized = deferred(), entered = deferred();
  const reader = h.api.createCellReader(async () => ({
    recognize() { entered.resolve(); return recognized.promise; }, close: async () => {}
  }));
  const pending = reader.recognizeRegion({ source: 'paddle-v5' }, [.1, .1, .5, .5], { canvas: h.canvas(1200, 1500) });
  await entered.promise; await reader.close(); recognized.resolve({ text: 'stale result' });
  await assert.rejects(pending, { name: 'AbortError' });
});

test('cancelling during old-session release does not initialize the next model', async () => {
  const h = harness(), closing = deferred(), releaseStarted = deferred(), controller = new AbortController(); let creates = 0;
  const reader = h.api.createCellReader(async () => {
    creates++; const first = creates === 1;
    return { recognize: async () => ({ text: 'ready' }), close: async () => {
      if (first) { releaseStarted.resolve(); await closing.promise; }
    } };
  });
  const canvas = h.canvas(1200, 1500), box = [.1, .1, .5, .5];
  await reader.recognizeRegion({ source: 'tesseract', language: 'eng' }, box, { canvas });
  const pending = reader.recognizeRegion({ source: 'paddle-v5', language: 'kor+eng' }, box, { canvas, signal: controller.signal });
  await releaseStarted.promise; controller.abort(); closing.resolve();
  await assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(creates, 1);
  await reader.close();
});
