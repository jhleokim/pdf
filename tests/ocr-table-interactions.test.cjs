const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/ocr-correction.js'), 'utf8'), context);
const api = context.PDFOCRCorrection.data;
const plain = value => JSON.parse(JSON.stringify(value));

test('a boundary click anywhere in its wide hit strip and small jitter preserve its exact coordinate', () => {
  const drag = { start: 208, extent: 500, origin: 0.4 };
  assert.deepEqual(plain(api.boundaryPointerValue(drag, 208)), { moved: false, value: 0.4 });
  assert.deepEqual(plain(api.boundaryPointerValue(drag, 210)), { moved: false, value: 0.4 });
  assert.deepEqual(plain(api.boundaryPointerValue(drag, 206)), { moved: false, value: 0.4 });
});

test('a boundary drag follows pointer displacement without jumping from the hit-strip offset', () => {
  const drag = { start: 208, extent: 500, origin: 0.4 };
  const moved = api.boundaryPointerValue(drag, 218);
  assert.equal(moved.moved, true);
  assert.ok(Math.abs(moved.value - 0.42) < 1e-12);
  assert.ok(Math.abs(api.boundaryPointerValue({ ...drag, extent: 1000 }, 218).value - 0.41) < 1e-12);
  assert.deepEqual(plain(api.boundaryPointerValue({ ...drag, moved: true }, 208)), { moved: true, value: 0.4 });
});

test('replacement limits account for every table on the page before changing existing results', () => {
  const grid = (rows, cols) => ({ x: Array.from({ length: cols + 1 }, (_, i) => i / cols), y: Array.from({ length: rows + 1 }, (_, i) => i / rows), cells: [] });
  const existing = [grid(25, 10), grid(25, 10)], snapshot = JSON.stringify(existing);
  assert.throws(() => api.checkTableReplacement(existing, 0, grid(36, 10)), /600/);
  assert.equal(JSON.stringify(existing), snapshot);
  assert.equal(api.checkTableReplacement(existing, 0, grid(35, 10)).length, 2);
});

test('undo restores a deleted manually corrected amount after later typing and page navigation', () => {
  const history = api.createTableHistory();
  const original = [{ cells: [{ id: 'r0c0', text: '1,250,007', edited: true }, { id: 'r1c0', text: '80' }] }];
  history.push(0, original, 0);
  const afterDelete = [{ cells: [{ id: 'r0c0', text: '80' }] }];
  history.push(0, afterDelete, 0);
  afterDelete[0].cells[0].text = '81';
  history.push(1, [{ cells: [{ text: '다른 페이지' }] }], 0);
  assert.equal(history.undo(0).tables[0].cells[0].text, '80');
  const restored = history.undo(0).tables;
  assert.equal(restored[0].cells[0].text, '1,250,007');
  assert.equal(restored[0].cells[0].edited, true);
  assert.equal(history.has(1), true);
  assert.equal(original[0].cells[0].text, '1,250,007');
});

test('table undo memory is bounded across pages and refuses an oversized snapshot', () => {
  const history = api.createTableHistory({ limit: 3, maxChars: 160 });
  for (let page = 0; page < 8; page++) history.push(page, [{ text: String(page).repeat(15) }], 0);
  assert.ok(history.size <= 3);
  assert.ok(history.chars <= 160);
  assert.equal(history.has(0), false);
  assert.equal(history.has(7), true);
  const before = history.size;
  assert.throws(() => history.push(9, [{ text: 'x'.repeat(200) }], 0), /메모리/);
  assert.equal(history.size, before);
  history.clear();
  assert.equal(history.size, 0);
  assert.equal(history.chars, 0);
});

test('disconnected traced borders stay separate and are not extrapolated across a merged header', () => {
  const traces = [
    { index: 2, points: [[0.3, 0.1], [0.31, 0.2]] },
    { index: 2, points: [[0.35, 0.5], [0.36, 0.9]] },
    { index: 3, points: [[0.6, 0.1], [0.6, 0.9]] }
  ];
  const parts = plain(api.clipTraceParts(traces, 'x', 2, 0.1, 0.9));
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].at(-1), [0.31, 0.2]);
  assert.deepEqual(parts[1][0], [0.35, 0.5]);
  assert.deepEqual(plain(api.clipTraceParts(traces, 'x', 2, 0.3, 0.4)), []);
  const second = plain(api.clipTraceParts(traces, 'x', 2, 0.6, 0.8));
  assert.equal(second.length, 1);
  assert.equal(second[0][0][1], 0.6);
  assert.equal(second[0].at(-1)[1], 0.8);
});
