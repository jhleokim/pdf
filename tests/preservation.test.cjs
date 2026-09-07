'use strict';

// Run with: node --test tests/preservation.test.cjs
// Uses the real libraries shipped inside the standalone artifact; no npm install.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const context = vm.createContext({
  console: { log() {}, warn() {}, error: console.error },
  setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, URLSearchParams, Blob,
  ReadableStream, WritableStream, TransformStream, AbortController, AbortSignal,
  atob, btoa, DOMException, ArrayBuffer, Uint8Array, Uint8ClampedArray,
  Int8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array,
  Float64Array, DataView,
});
function run(code, filename) { return vm.runInContext(code, context, { filename }); }
function bundled(marker) {
  const code = scripts.find(s => s.includes(marker));
  assert.ok(code, `The standalone must include ${marker}`);
  return code;
}
run(bundled('sourceMappingURL=pdf-lib.min.js.map'), 'bundled-pdf-lib.js');
run(bundled('pdfjs-dist/build/pdf"]'), 'bundled-pdf.js');
run(bundled('pdfjs-dist/build/pdf.worker'), 'bundled-pdf.worker.js');
run(fs.readFileSync(path.join(root, 'src/pro-document.js'), 'utf8'), 'pro-document.js');

// Keep PDF-lib and its callers in one realm: its public API checks instanceof
// Array, so crossing the VM boundary with Node-created arrays is invalid.
function defineTests() {
const P = context.PDFLib;
const pro = context.PDFProDocument;
const mm = 72 / 25.4;
const pixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
const plain = value => JSON.parse(JSON.stringify(value));
function near(actual, expected, message = '') {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);
}
function nearArray(actual, expected, message) {
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) => near(n, expected[i], `${message || 'coordinate'} ${i}`));
}
function options(extra = {}) {
  return { crop: false, margins: [0, 0, 0, 0], paper: 'original', number: false,
    watermark: '', skipPages: 0, startNumber: 1, numberPosition: 'bottom-center', ...extra };
}

// A valid non-embedded Type0 font is enough for an invisible OCR layer. The
// ToUnicode CMap makes this exercise CJK extraction, without relying on system
// fonts, a download, or a rendering mock.
function koreanFont(doc) {
  const c = doc.context;
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Fixture-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
4 beginbfchar
<0001> <D55C>
<0002> <AE00>
<0003> <AC80>
<0004> <C0C9>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  const descriptor = c.register(c.obj({ Type: 'FontDescriptor', FontName: 'KoreanFixture',
    Flags: 4, FontBBox: [0, 0, 1000, 1000], ItalicAngle: 0, Ascent: 1000,
    Descent: 0, CapHeight: 1000, StemV: 80 }));
  const cid = c.register(c.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'KoreanFixture',
    CIDSystemInfo: { Registry: P.PDFString.of('Adobe'), Ordering: P.PDFString.of('Identity'), Supplement: 0 },
    FontDescriptor: descriptor, DW: 1000 }));
  return c.register(c.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'KoreanFixture',
    Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: c.register(c.flateStream(cmap)) }));
}

async function fixture({ count = 4, form = false, userUnit = 1 } = {}) {
  const doc = await P.PDFDocument.create();
  const latin = await doc.embedFont(P.StandardFonts.Helvetica);
  const korean = koreanFont(doc);
  const image = await doc.embedPng(pixelPng);
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([400, 600]);
    page.setMediaBox(-20, 40, 400, 600);
    page.setCropBox(5, 65, 350, 535);
    page.setRotation(P.degrees((i % 4) * 90));
    if (userUnit !== 1) page.node.set(P.PDFName.of('UserUnit'), P.PDFNumber.of(userUnit));
    page.drawImage(image, { x: 20, y: 80, width: 100, height: 100 });
    page.drawText(`VISIBLE PAGE ${i + 1}`, { x: 30, y: 520, font: latin, size: 12 });
    const latinName = page.node.newFontDictionary('OCR', latin.ref);
    const koreanName = page.node.newFontDictionary('Korean', korean);
    page.pushOperators(
      P.beginText(), P.setFontAndSize(latinName, 12), P.setTextRenderingMode(3),
      P.setTextMatrix(1, 0, 0, 1, 30, 490), P.showText(latin.encodeText('OCR HIDDEN 123.45')), P.endText(),
      P.beginText(), P.setFontAndSize(koreanName, 12), P.setTextRenderingMode(3),
      P.setTextMatrix(1, 0, 0, 1, 30, 460), P.showText(P.PDFHexString.of('0001000200030004')), P.endText(),
    );
  }
  if (form) {
    const field = doc.getForm().createTextField('customer');
    field.setText('Original form');
    field.addToPage(doc.getPage(0), { x: 30, y: 300, width: 150, height: 20 });
  }
  return doc;
}

async function inspect(bytes) {
  const pdf = await context.pdfjsLib.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  try {
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const items = (await p.getTextContent()).items.filter(x => typeof x.str === 'string' && x.str);
      pages.push({ text: items.map(x => x.str), items: plain(items), viewport: p.getViewport({ scale: 1 }) });
    }
    return pages;
  } finally { await pdf.destroy(); }
}
function imageCount(doc) {
  return doc.context.enumerateIndirectObjects().filter(([, object]) =>
    object.dict?.get(P.PDFName.of('Subtype'))?.toString() === '/Image').length;
}
function arrays(dict, name) { return plain(dict.lookup(P.PDFName.of(name)).asArray().map(n => n.asNumber())); }

test('copy/reorder/delete retains invisible Latin and CJK OCR, page boxes, rotations and a shared image', async () => {
  const original = await fixture();
  const bytes = await original.save();
  const before = await inspect(bytes);
  before.forEach(p => assert.ok(p.text.includes('한글검색')));
  const source = await P.PDFDocument.load(bytes);
  const copy = await P.PDFDocument.create();
  const order = [3, 0, 2];
  (await copy.copyPages(source, order)).forEach(page => copy.addPage(page));
  const result = await copy.save();
  const after = await inspect(result);
  const reread = await P.PDFDocument.load(result);
  for (let i = 0; i < order.length; i++) {
    assert.deepEqual(plain(after[i].text), plain(before[order[i]].text));
    assert.deepEqual(plain(reread.getPage(i).getMediaBox()), plain(source.getPage(order[i]).getMediaBox()));
    assert.deepEqual(plain(reread.getPage(i).getCropBox()), plain(source.getPage(order[i]).getCropBox()));
    assert.equal(reread.getPage(i).getRotation().angle, source.getPage(order[i]).getRotation().angle);
  }
  assert.equal(imageCount(reread), 1, 'The page copy must not duplicate shared image streams');
});

test('full-document load/save retains existing form values and invisible OCR', async () => {
  const bytes = await (await fixture({ form: true })).save();
  const doc = await P.PDFDocument.load(bytes);
  await pro.applyDocument(doc, options());
  const result = await doc.save({ useObjectStreams: true });
  const reread = await P.PDFDocument.load(result);
  assert.equal(reread.getForm().getTextField('customer').getText(), 'Original form');
  assert.deepEqual(plain((await inspect(result)).map(p => p.text)), plain((await inspect(bytes)).map(p => p.text)));
});

test('display edge crop follows all four rotations, offset boxes and physical UserUnit', async () => {
  for (const userUnit of [1, 2]) {
    const doc = await fixture({ userUnit });
    const before = await inspect(await doc.save());
    const [top, right, bottom, left] = [3, 5, 7, 11].map(v => v * mm / userUnit);
    for (let i = 0; i < 4; i++) {
      const page = doc.getPage(i);
      pro.geometry(page, options({ crop: true, margins: [3, 5, 7, 11] }), i + 1);
      const b = page.getCropBox(), vp = before[i].viewport;
      const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .map(([x, y]) => vp.convertToViewportPoint(x, y));
      nearArray([Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])),
        Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))],
      [left, top, vp.width - right, vp.height - bottom], `rotation ${i * 90}, UserUnit ${userUnit}`);
    }
  }
});

test('A4 fitting keeps exact paper size, OCR and translated/scaled annotation coordinates', async () => {
  const doc = await fixture({ userUnit: 2 });
  const before = await inspect(await doc.save());
  const rect = [30, 100, 160, 135], quad = [30, 135, 160, 135, 30, 100, 160, 100];
  for (const page of doc.getPages()) {
    const annotation = doc.context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: rect, QuadPoints: quad });
    page.node.addAnnot(doc.context.register(annotation));
  }
  await pro.applyDocument(doc, options({ paper: 'a4' }));
  const result = await doc.save();
  const after = await inspect(result);
  const reread = await P.PDFDocument.load(result);
  const w = 210 * mm, h = 297 * mm, s = Math.min(w / 350, h / 535);
  const dx = (w - 350 * s) / 2 - 5 * s, dy = (h - 535 * s) / 2 - 65 * s;
  const convert = ns => ns.map((n, i) => n * s + (i % 2 ? dy : dx));
  for (let i = 0; i < 4; i++) {
    const page = reread.getPage(i);
    for (const key of ['getMediaBox', 'getCropBox', 'getTrimBox', 'getBleedBox', 'getArtBox']) {
      const b = page[key]();
      nearArray([b.x, b.y, b.width, b.height], [0, 0, w, h], key);
    }
    assert.equal(page.node.has(P.PDFName.of('UserUnit')), false);
    assert.equal(page.getRotation().angle, i * 90);
    assert.deepEqual(plain(after[i].text), plain(before[i].text));
    const annotation = page.node.Annots().lookup(0);
    nearArray(arrays(annotation, 'Rect'), convert(rect), 'annotation rect');
    nearArray(arrays(annotation, 'QuadPoints'), convert(quad), 'highlight quad');
    const hidden = after[i].items.find(x => x.str === 'OCR HIDDEN 123.45');
    nearArray(hidden.transform, [12 * s, 0, 0, 12 * s, 30 * s + dx, 490 * s + dy], 'OCR position');
  }
});

test('A4 preserves text and images inside a nested Form XObject', async () => {
  const source = await fixture({ count: 1 });
  const outer = await P.PDFDocument.create();
  const [inner] = await outer.embedPdf(await source.save(), [0]);
  const page = outer.addPage([500, 750]);
  page.drawPage(inner, { x: 35, y: 50, width: 350, height: 525 });
  const before = await inspect(await outer.save());
  await pro.applyDocument(outer, options({ paper: 'a4' }));
  const bytes = await outer.save();
  const after = await inspect(bytes);
  assert.deepEqual(plain(after[0].text), plain(before[0].text));
  assert.ok(after[0].text.includes('한글검색'));
  assert.equal(imageCount(await P.PDFDocument.load(bytes)), 1);
});

test('page numbers skip covers and a preview pageOffset matches the full export', async () => {
  const original = await (await fixture()).save();
  // Production edits a loaded original, rather than a fixture's already-saved
  // cached PDFContentStream. That distinction matters when appending new text.
  const source = await P.PDFDocument.load(original);
  const opts = options({ number: true, skipPages: 2, startNumber: 7, numberPosition: 'bottom-right' });
  await pro.applyDocument(source, opts);
  const full = await inspect(await source.save());
  assert.equal(full[0].text.includes('7'), false);
  assert.equal(full[1].text.includes('7'), false);
  assert.equal(full[2].text.at(-1), '7');
  assert.equal(full[3].text.at(-1), '8');
  const preview = await P.PDFDocument.create();
  const loaded = await P.PDFDocument.load(original);
  const [page] = await preview.copyPages(loaded, [2]);
  preview.addPage(page);
  await pro.applyDocument(preview, opts, { pageOffset: 2 });
  const single = await inspect(await preview.save());
  assert.deepEqual(plain(single[0].text), plain(full[2].text));
  nearArray(single[0].items.at(-1).transform, full[2].items.at(-1).transform, 'preview page number');
});

test('numbers added after A4 fit use the output coordinates and keep 10pt size', async () => {
  const doc=await P.PDFDocument.load(await (await fixture({count:1})).save());
  await pro.applyDocument(doc,options({paper:'a4',number:true,startNumber:91}));
  const result=await inspect(await doc.save());
  const number=result[0].items.find(x=>x.str==='91');
  assert.ok(number);
  near(number.transform[0],10,'number font size');
  near(number.transform[5],12*mm,'number baseline at 12mm');
});

test('A4 does not reveal annotations outside the existing visible crop', async () => {
  const doc=await fixture({count:1});
  const annotation=doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[-15,50,20,90]});
  doc.getPage(0).node.addAnnot(doc.context.register(annotation));
  await assert.rejects(pro.applyDocument(doc,options({paper:'a4'})),/재단 경계/);
});

test('impossible crop fails before changing the page box and cancellation is respected', async () => {
  const doc = await fixture({ count: 1 });
  const before = plain(doc.getPage(0).getCropBox());
  assert.throws(() => pro.geometry(doc.getPage(0), options({ crop: true, margins: [100, 100, 100, 100] }), 1), /10mm/);
  assert.deepEqual(plain(doc.getPage(0).getCropBox()), before);
  await assert.rejects(pro.applyDocument(doc, options(), { signal: { aborted: true } }), { name: 'AbortError' });
});
}
context.test = test;
context.assert = assert;
context.context = context;
run(`(${defineTests.toString()})();`, 'preservation-fixtures.js');
