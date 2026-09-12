const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {mkdtempSync, writeFileSync, unlinkSync, rmdirSync, readFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {createHash} = require('node:crypto');

async function fixture() {
  const builder = await import('../scripts/build-ppocr-v5.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'pdf-ppv5-bootstrap-'));
  const content = Buffer.from('/* local fixture */'), sha256 = createHash('sha256').update(content).digest('hex');
  const file = 'adapter-' + sha256.slice(0, 16) + '.js';
  writeFileSync(join(directory, file), content);
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({model: builder.PPOCRV5_MODEL, runtimeURL: '/ocr/ppocr-v5/' + file, assets: {'adapter.js': {file, bytes: content.length, sha256}}}));
  return {directory, builder, cleanup() {unlinkSync(join(directory, file)); unlinkSync(join(directory, 'manifest.json')); rmdirSync(directory);}};
}

test('standalone bootstrap stays lazy, uses Blob scripts, and reuses its loaded engine', async () => {
  const f = await fixture();
  try {
    const created = [], scripts = [], context = {setTimeout, clearTimeout, atob, Uint8Array, Blob,
      URL: {createObjectURL(blob) {created.push(blob); return 'blob:local-' + created.length;}},
      document: {createElement: () => ({remove() {}}), head: {append(script) {scripts.push(script); queueMicrotask(() => {context.PDFPaddleV5 = {model: f.builder.PPOCRV5_MODEL}; script.onload();});}}}};
    vm.runInNewContext(f.builder.getPPOCRV5Bootstrap({standalone: true, outputDirectory: f.directory}), context);
    assert.equal(created.length, 0); assert.equal(scripts.length, 0);
    const first = context.PDFPaddleLoad(), second = context.PDFPaddleLoad();
    assert.equal(first, second);
    assert.equal((await first).model, f.builder.PPOCRV5_MODEL);
    assert.equal(scripts[0].src, 'blob:local-1');
    assert.equal(context.PDFPaddleV5Assets['adapter.js'], 'blob:local-1');
    assert.equal(created.length, 1); assert.equal(scripts.length, 1);
    await context.PDFPaddleLoad(); assert.equal(scripts.length, 1);
  } finally {f.cleanup();}
});

test('web bootstrap can retry a failed runtime download', async () => {
  const f = await fixture();
  try {
    const scripts = [], context = {setTimeout, clearTimeout, document: {createElement: () => ({remove() {}}), head: {append(script) {scripts.push(script); queueMicrotask(() => {if (scripts.length === 1) script.onerror(); else {context.PDFPaddleV5 = {model: f.builder.PPOCRV5_MODEL}; script.onload();}});}}}};
    vm.runInNewContext(f.builder.getPPOCRV5Bootstrap({outputDirectory: f.directory}), context);
    await assert.rejects(context.PDFPaddleLoad(), /불러오지/);
    assert.equal(context.PDFPaddleReady, null);
    assert.equal((await context.PDFPaddleLoad()).model, f.builder.PPOCRV5_MODEL);
    assert.match(scripts[1].src, /^\/ocr\/ppocr-v5\/adapter-[a-f0-9]{16}\.js$/);
  } finally {f.cleanup();}
});

test('adapter can initialize its API from a Blob script in a file document', () => {
  const context = {URL, location: {href: 'file:///C:/PDF-Studio.html'}, document: {currentScript: {src: 'blob:null/local-adapter'}}};
  vm.runInNewContext(readFileSync(require.resolve('../src/ppocr-v5/adapter.js'), 'utf8'), context);
  assert.equal(typeof context.PDFPaddleV5.session, 'function');
});
