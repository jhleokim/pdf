'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const fixture = require('./table-validation-fixtures.cjs');
const context = vm.createContext({ performance });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/ocr-tables.js'), 'utf8'), context);
const api = context.PDFOCRTables;
const plain = value => JSON.parse(JSON.stringify(value));
function assertCoverage(table) {
  const rows = table.y.length - 1, cols = table.x.length - 1, occupied = new Uint8Array(rows * cols);
  for (const cell of table.cells) {
    assert.equal(cell.box[0], table.x[cell.col]); assert.equal(cell.box[1], table.y[cell.row]);
    assert.equal(cell.box[2], table.x[cell.col + cell.colSpan]); assert.equal(cell.box[3], table.y[cell.row + cell.rowSpan]);
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) for (let c = cell.col; c < cell.col + cell.colSpan; c++) occupied[r * cols + c]++;
  }
  assert.ok(occupied.every(count => count === 1), 'Every grid slot must belong to exactly one cell.');
}

test('independent contract fixture preserves merged title, empty cell, Korean text and every amount', () => {
  const words = fixture.words(), original = structuredClone(words);
  const result = api.detect(fixture.imageData(), { words });
  assert.equal(result.tables.length, 1, result.warnings.join('\n'));
  const table = result.tables[0]; assert.equal(table.cells.length, 17); assertCoverage(table);
  assert.equal(table.unassignedIndices.length, 0);
  for (const expected of fixture.expectedCells) {
    const actual = table.cells.find(c => c.row === expected.row && c.col === expected.col);
    assert.ok(actual, 'Missing cell ' + expected.row + '/' + expected.col);
    assert.equal(actual.rowSpan, expected.rowSpan); assert.equal(actual.colSpan, expected.colSpan);
    assert.equal(actual.text, expected.text);
  }
  const indices = table.cells.flatMap(cell => cell.wordIndices);
  assert.equal(new Set(indices).size, indices.length);
  assert.deepEqual(words, original, 'Original text, separators, and boxes cannot be mutated.');
  assert.match(api.toHTML(table), /colspan="4"/); assert.match(api.toTSV(table), /1,250,000/);
});

test('borderless text does not invent an automatic grid', () => {
  const result = api.detect(fixture.imageData({ borderless: true }), { words: fixture.words() });
  assert.equal(result.tables.length, 0); assert.ok(result.warnings.length);
});

test('small scan breaks in horizontal rules do not silently drop the amount column', () => {
  const result = api.detect(fixture.imageData({ broken: true }), { words: fixture.words() });
  if (!result.tables.length) { assert.ok(result.warnings.length, 'Refusing uncertain boundaries must explain how to proceed.'); return; }
  assert.equal(result.tables.length, 1, 'A five-pixel rule break must not turn one table into independent fragments.');
  const table = result.tables[0]; assert.equal(table.cells.length, 17); assertCoverage(table);
  for (const amount of ['1,250,000', '2,500,000', '-50,000']) assert.ok(table.cells.some(cell => cell.text === amount), amount);
});

test('a whole line crossing four cells remains intact and prevents partial export', () => {
  const words = fixture.words({ crossingLine: true }), result = api.detect(fixture.imageData(), { words });
  assert.equal(result.tables.length, 1);
  const table = result.tables[0], crossed = words.findIndex(w => w.text.startsWith('중도금 이우리'));
  assert.ok(table.unassignedIndices.includes(crossed));
  assert.ok(table.cells.every(cell => !cell.wordIndices.includes(crossed)));
  assert.equal(words[crossed].text, '중도금 이우리 2,500,000 2026-09-14');
  assert.throws(() => api.toTSV(table)); assert.throws(() => api.toHTML(table));
  assertCoverage(table);
});

test('merge/split invariants across 70 rectangular grids: no holes, overlap or source mutation', () => {
  for (let rows = 2; rows <= 8; rows++) for (let cols = 2; cols <= 11; cols++) {
    const x = Array.from({ length: cols + 1 }, (_, i) => .1 + .8 * i / cols);
    const y = Array.from({ length: rows + 1 }, (_, i) => .1 + .8 * i / rows);
    const input = { x, y, words: [] }, original = structuredClone(input), table = api.fromGrid(input), snapshot = plain(table);
    const picked = table.cells.filter(c => c.row < 2 && c.col < 2).map(c => c.id);
    const merged = api.merge(table, picked, []); assert.equal(merged.cells.length, rows * cols - 3); assertCoverage(merged);
    assert.deepEqual(plain(table), snapshot); assert.deepEqual(input, original);
    const split = api.split(merged, merged.cells.find(c => c.row === 0 && c.col === 0).id, []);
    assert.equal(split.cells.length, rows * cols); assertCoverage(split);
  }
});

test('edited cells survive geometry movement and warn if their OCR membership changes', () => {
  const words = [{ text: '00123', box: [.25, .2, .45, .3], confidence: 99 }];
  const table = api.fromGrid({ x: [.1, .5, .9], y: [.1, .9], words });
  table.cells[0].text = '00124'; table.cells[0].edited = true; table.reviewed = true;
  const moved = api.moveBoundary(table, 'x', 1, .3, words);
  assert.equal(moved.cells[0].text, '00124'); assert.equal(moved.reviewed, false);
  assert.ok(moved.cells[0].reasons.includes('edited-cell-remapped'));
  assert.equal(table.reviewed, true); assert.equal(table.x[1], .5);
});

test('exports neutralize formulas, escape markup and retain exact display text', () => {
  const table = api.fromGrid({ x: [0, 1], y: [0, 1], words: [] });
  for (const text of ['=1+1', '+SUM(A1:A3)', '-1+2', '@SUM(A1)', ' \t=HYPERLINK("https://example.invalid")']) {
    table.cells[0].text = text;
    assert.match(api.toTSV(table), /'/, 'Formula must be prefixed before spreadsheet import.');
  }
  table.cells[0].text = '<img src=x onerror=alert(1)> 00123 123456789012345678';
  const html = api.toHTML(table);
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/); assert.match(html, /mso-number-format/);
  assert.match(html, /00123 123456789012345678/);
  table.cells[0].text = '0'; assert.equal(api.toTSV(table), '0');
  table.cells[0].text = ''; assert.equal(api.toTSV(table), '');
});

test('uncertain normalized OCR words are not silently presented as confident cells', () => {
  for (const properties of [{ confidence: 1 }, { confidence: 65 }, { confidence: 99, uncertain: true }]) {
    const table = api.fromGrid({ x: [0, 1], y: [0, 1], words: [{ text: '금액', box: [.2, .2, .4, .4], ...properties }] });
    assert.ok(table.cells[0].reasons.includes('low-confidence'), JSON.stringify(properties));
  }
});
