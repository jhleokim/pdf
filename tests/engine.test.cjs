/* Run with: node --test tests/engine.test.cjs
 * The real bundled PDFLib is used. Canvas is stubbed only for deterministic codec
 * boundary tests; browser tests must separately cover actual JPEG image rendering.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bundledLib = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).find(script => script.includes('.PDFLib='));
assert.ok(bundledLib, 'bundled PDFLib must be available offline');
const libModule = { exports: {} };
vm.runInNewContext(bundledLib, { exports: libModule.exports, module: libModule, Array,
  Uint8Array, ArrayBuffer, Int32Array, Uint32Array, Uint16Array, Int16Array, Int8Array,
  Float32Array, Float64Array, setTimeout, clearTimeout });
const P = globalThis.PDFLib = libModule.exports;
const engine = require('../src/pro-engine.js');
const name = key => P.PDFName.of(key);

function image(doc, extra = {}, bytes = new Uint8Array(48).fill(180)) {
  const stream = doc.context.stream(bytes, { Type: 'XObject', Subtype: 'Image', Width: 4,
    Height: 4, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', ...extra });
  return [doc.context.register(stream), stream];
}
function pngPredict(data, width, channels, filters) {
  const stride = width * channels;
  const result = new Uint8Array(data.length + filters.length);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let row = 0; row < filters.length; row++) {
    const filter = filters[row];
    result[row * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const pos = row * stride + x;
      const a = x >= channels ? data[pos - channels] : 0;
      const b = row ? data[pos - stride] : 0;
      const c = row && x >= channels ? data[pos - stride - channels] : 0;
      const offset = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      result[row * (stride + 1) + 1 + x] = (data[pos] - offset) & 255;
    }
  }
  return result;
}

test('options clamp resource-sensitive controls and never request an upsample', () => {
  assert.deepEqual(engine.normalizeOptions({}), { optimize: true, maxDimension: 2400,
    jpegQuality: .82, grayscale: false, blackWhite:false, bwThreshold:180, contrast: 0, whitePoint: 255 });
  assert.deepEqual(engine.normalizeOptions({ optimize: false, maxDimension: Infinity,
    jpegQuality: 8, contrast: -1, whitePoint: 2 }), { optimize: false,
    maxDimension: 2400, jpegQuality: .95, grayscale: false, blackWhite:false, bwThreshold:180, contrast: 0, whitePoint: 200 });
});

test('real PDF dictionaries conservatively reject masks, CMYK, indexed colors and unsafe sizes', async () => {
  const doc = await P.PDFDocument.create();
  for (const [extra, reason] of [
    [{ SMask: doc.context.register(doc.context.stream(Uint8Array.of(0))) }, 'mask'],
    [{ Mask: [0, 0, 0, 0, 0, 0] }, 'mask'],
    [{ ImageMask: true }, 'mask'],
    [{ ColorSpace: 'DeviceCMYK' }, 'color'],
    [{ ColorSpace: ['ICCBased', doc.context.register(doc.context.stream(Uint8Array.of(0)))] }, 'color'],
    [{ ColorSpace: ['Indexed', 'DeviceRGB', 0, P.PDFHexString.of('000000')] }, 'color'],
    [{ Decode: [1, 0, 1, 0, 1, 0] }, 'decode'],
    [{ Filter: ['ASCII85Decode', 'DCTDecode'] }, 'filter'],
    [{ Filter: 'CCITTFaxDecode' }, 'filter'],
    [{ Filter: 'JBIG2Decode' }, 'filter'],
    [{ BitsPerComponent: 1 }, 'precision'],
    [{ Width: 5000, Height: 5000 }, 'dimensions'],
    [{ Width: 16385, Height: 1 }, 'dimensions'],
    [{ Width: -1 }, 'dimensions'],
    [{ Filter: 'FlateDecode', DecodeParms: { Predictor: 12, Columns: 4, Colors: 1 } }, 'predictor']
  ]) {
    const [, stream] = image(doc, extra);
    assert.throws(() => engine.imageSpec(stream, P), error => error.reasonCode === reason);
  }
  const [, plain] = image(doc);
  assert.equal(engine.imageSpec(plain, P).channels, 3);
  const [, gray] = image(doc, { ColorSpace: 'DeviceGray' }, new Uint8Array(16));
  assert.equal(engine.imageSpec(gray, P).channels, 1);
});

test('PNG predictor unfiltering reconstructs all five filters for RGB and gray', async () => {
  for (const channels of [1, 3]) {
    const width = 7, height = 5;
    const original = Uint8Array.from({ length: width * channels * height }, (_, i) => (i * 43 + 127) & 255);
    const encoded = pngPredict(original, width, channels, [0, 1, 2, 3, 4]);
    const actual = await engine.undoPredictor(encoded, { width, height, channels, predictor: 15 });
    assert.deepEqual(actual, original);
  }
});

test('TIFF horizontal predictor reconstructs independent rows with 8-bit wraparound', async () => {
  const original = Uint8Array.from([240, 100, 0, 10, 90, 255, 0, 2, 4, 200, 10, 99]);
  const encoded = original.slice();
  for (let row = 0; row < 2; row++) for (let x = 5; x >= 3; x--)
    encoded[row * 6 + x] = (original[row * 6 + x] - original[row * 6 + x - 3]) & 255;
  assert.deepEqual(await engine.undoPredictor(encoded, { width: 2, height: 2, channels: 3, predictor: 2 }), original);
});

test('native inflater verifies exact output size, rejects over-expansion and truncated data', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
  const compressed = zlib.deflateSync(bytes);
  assert.deepEqual(await engine.inflateBounded(compressed, 5), bytes);
  await assert.rejects(engine.inflateBounded(compressed, 4));
  await assert.rejects(engine.inflateBounded(compressed, 6));
  await assert.rejects(engine.inflateBounded(compressed.subarray(0, 4), 5));
  const signal = AbortSignal.abort();
  await assert.rejects(engine.inflateBounded(compressed, 5, signal), { name: 'AbortError' });
});

test('JPEG header validation prevents dimensions/component mismatches and EXIF orientation changes', () => {
  const jpeg = Uint8Array.from([255,216,255,192,0,17,8,0,4,0,4,3,1,17,0,2,17,0,3,17,0,255,218,0,2]);
  engine.inspectJpeg(jpeg, { width: 4, height: 4, channels: 3 });
  assert.throws(() => engine.inspectJpeg(jpeg, { width: 4, height: 5, channels: 3 }));
  assert.throws(() => engine.inspectJpeg(jpeg, { width: 4, height: 4, channels: 1 }));
  const exif = Uint8Array.from([255,216,255,225,0,8,69,120,105,102,0,0,...jpeg.subarray(2)]);
  assert.throws(() => engine.inspectJpeg(exif, { width: 4, height: 4, channels: 3 }));
});

test('ordinary Canvas sRGB JPEG is accepted; changed, split or duplicate ICC profiles stay protected',()=>{
  const profile=Uint8Array.from(Buffer.from('4943435f50524f46494c45000101000001c800000000043000006d6e74725247422058595a2007e00001000100000000000061637370000000000000000000000000000000000000000000000000000000010000f6d6000100000000d32d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000964657363000000f0000000247258595a00000114000000146758595a00000128000000146258595a0000013c00000014777470740000015000000014725452430000016400000028675452430000016400000028625452430000016400000028637072740000018c0000003c6d6c756300000000000000010000000c656e5553000000080000001c007300520047004258595a200000000000006fa2000038f50000039058595a2000000000000062990000b785000018da58595a2000000000000024a000000f840000b6cf58595a20000000000000f6d6000100000000d32d706172610000000000040000000266660000f2a700000d59000013d000000a5b00000000000000006d6c756300000000000000010000000c656e5553000000200000001c0047006f006f0067006c006500200049006e0063002e00200032003000310036','hex'));
  const tail=[255,192,0,17,8,0,4,0,4,3,1,17,0,2,17,0,3,17,0,255,218,0,2];
  const segment=[255,226,1,216,...profile],spec={width:4,height:4,channels:3};
  engine.inspectJpeg(Uint8Array.from([255,216,...segment,...tail]),spec);
  for(const position of [12,13,300,350]){
    const changed=profile.slice();changed[position]^=1;
    assert.throws(()=>engine.inspectJpeg(Uint8Array.from([255,216,255,226,1,216,...changed,...tail]),spec));
  }
  assert.throws(()=>engine.inspectJpeg(Uint8Array.from([255,216,...segment,...segment,...tail]),spec));
});

function mockCanvas(encodedSize = 12) {
  const canvases = [];
  const document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    const context = {
      createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
      putImageData() {}, drawImage() {},
      getImageData(x, y, width, height) { return { data: new Uint8ClampedArray(width * height * 4).fill(160) }; }
    };
    const canvas = { width: 0, height: 0, getContext: () => context,
      toBlob(callback, type) { callback(new Blob([new Uint8Array(encodedSize)], { type })); } };
    canvases.push(canvas);
    return canvas;
  } };
  return { document, canvases };
}

test('image replacement reuses the original ref and preserves hidden OCR, vectors, boxes, and nested references', async () => {
  const canvas = mockCanvas();
  globalThis.document = canvas.document;
  try {
    const doc = await P.PDFDocument.create();
    const [ref, originalImage] = image(doc);
    const form = doc.context.stream('q 20 0 0 20 0 0 cm /Scan Do Q', {
      Type: 'XObject', Subtype: 'Form', BBox: [0,0,200,200],
      Resources: { XObject: { Scan: ref } }
    });
    const formRef = doc.context.register(form);
    const pages = [doc.addPage([600,800]), doc.addPage([600,800])];
    const font = await doc.embedFont(P.StandardFonts.Helvetica);
    const ocr = 'ABBYY hidden OCR survives 123';
    for (const page of pages) {
      page.drawText(ocr, { font, opacity: 0 });
      page.drawRectangle({ x: 10, y: 20, width: 40, height: 40 });
      page.setCropBox(10, 20, 500, 700);
      page.setRotation(P.degrees(90));
      page.node.set(name('Resources'), doc.context.obj({
        ...Object.fromEntries(page.node.Resources().entries().map(([k,v]) => [k.decodeText(),v])),
        XObject: { Scan: ref, NestedScan: formRef }
      }));
    }
    // Ensure generated content objects exist before taking the preservation snapshot.
    await doc.flush();
    const before = new Map(doc.context.enumerateIndirectObjects().map(([r,o]) => [r.toString(), o]));
    const beforeCount = before.size;
    const progress = [];
    const report = await engine.processDocument(doc, {}, { onProgress: p => progress.push(p) });
    assert.equal(report.changed, 1);
    assert.equal(report.imageCount, 1, 'shared image is optimized once');
    assert.equal(report.originalImageBytes, 48);
    assert.equal(report.resultImageBytes, 12);
    assert.equal(report.processed, 1);
    assert.equal(doc.context.enumerateIndirectObjects().length, beforeCount, 'no dangling original image object is added');
    assert.notEqual(doc.context.lookup(ref), originalImage);
    for (const [r,object] of doc.context.enumerateIndirectObjects()) {
      if (r.toString() !== ref.toString()) assert.equal(object, before.get(r.toString()), 'every non-image PDF object is untouched');
    }
    assert.equal(doc.context.lookup(formRef), form);
    assert.deepEqual({ ...pages[0].getCropBox() }, { x: 10, y: 20, width: 500, height: 700 });
    assert.equal(pages[0].getRotation().angle, 90);
    const replacement = doc.context.lookup(ref);
    assert.equal(replacement.dict.lookup(name('Filter')).asString(), '/DCTDecode');
    assert.equal(replacement.dict.lookup(name('Width')).asNumber(), 4, 'small images are never upscaled');
    assert.equal(progress.at(-1).completed, 1);
    assert.ok(canvas.canvases.every(c => c.width === 1 && c.height === 1), 'canvases are released');
    // Saving/reloading with the real serializer preserves the same page resources and content bytes.
    const saved = await doc.save();
    const loaded = await P.PDFDocument.load(saved);
    assert.equal(loaded.getPageCount(), 2);
    assert.equal(loaded.getPage(0).getRotation().angle, 90);
    const textHex = Buffer.from(ocr).toString('hex').toUpperCase();
    assert.ok(loaded.context.enumerateIndirectObjects().some(([,object]) => {
      if (!(object instanceof P.PDFRawStream) || object.dict.lookup(name('Subtype')) === name('Image')) return false;
      try { return Buffer.from(P.decodePDFRawStream(object).decode()).toString().includes(textHex); } catch { return false; }
    }), 'the hidden OCR text operators survive save/reload');
  } finally { delete globalThis.document; }
});

test('optimization refuses larger encodings, while explicitly requested enhancement can grow', async () => {
  globalThis.document = mockCanvas(80).document;
  try {
    const doc = await P.PDFDocument.create();
    const [ref, stream] = image(doc);
    const report = await engine.processDocument(doc, { optimize: true });
    assert.equal(report.changed, 0);
    assert.equal(report.skipReasons.notSmaller, 1);
    assert.equal(doc.context.lookup(ref), stream);
    const enhanced = await engine.processDocument(doc, { optimize: false, grayscale: true });
    assert.equal(enhanced.changed, 1);
    assert.equal(enhanced.resultImageBytes, 80);
    assert.equal(doc.context.lookup(ref).dict.lookup(name('Width')).asNumber(), 4);
  } finally { delete globalThis.document; }
});

test('cancellation stops before mutation and unsupported streams are counted without browser decoding', async () => {
  const doc = await P.PDFDocument.create();
  const [ref, stream] = image(doc, { Filter: 'JBIG2Decode', BitsPerComponent: 1 });
  await assert.rejects(engine.processDocument(doc, {}, { signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(doc.context.lookup(ref), stream);
  const report = await engine.processDocument(doc, {});
  assert.equal(report.skipped, 1);
  assert.equal(report.changed, 0);
  assert.equal(report.originalImageBytes, report.resultImageBytes);
  assert.ok(report.notes.length);
  assert.equal(doc.context.lookup(ref), stream);
});

test('grayscale transforms RGB pixels when optimization is off, without altering the source stream', async () => {
  let encodedPixels;
  globalThis.document={createElement(){
    const canvas={width:0,height:0,pixels:null};
    const context={
      createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
      putImageData(strip){canvas.pixels=strip.data.slice();},
      drawImage(source){canvas.pixels=source.pixels.slice();},
      getImageData(){return {data:canvas.pixels.slice()};}
    };
    canvas.getContext=()=>context;
    canvas.toBlob=(cb,type)=>{encodedPixels=canvas.pixels.slice();cb(new Blob([new Uint8Array(12)],{type}));};
    return canvas;
  }};
  try{
    const doc=await P.PDFDocument.create();
    const colors=Uint8Array.from([255,0,0,0,255,0,0,0,255,255,255,255]);
    const [ref,source]=image(doc,{Width:4,Height:1},colors);
    const report=await engine.processDocument(doc,{optimize:false,grayscale:true});
    assert.equal(report.changed,1);
    assert.deepEqual([...encodedPixels],[54,54,54,255,182,182,182,255,18,18,18,255,255,255,255,255]);
    assert.deepEqual([...source.getContents()],[...colors]);
    assert.notEqual(doc.context.lookup(ref),source);
  }finally{delete globalThis.document;}
});


test('soft-mask images and nested transparency-group resources are never recolored or resized',async()=>{
 const doc=await P.PDFDocument.create();
 const [maskRef,mask]=image(doc,{ColorSpace:'DeviceGray'},new Uint8Array(16).fill(128));
 const [,parent]=image(doc,{SMask:maskRef});
 const [groupImageRef,groupImage]=image(doc);
 const nested=doc.context.register(doc.context.stream('q /Alpha Do Q',{Type:'XObject',Subtype:'Form',BBox:[0,0,4,4],Resources:{XObject:{Alpha:groupImageRef}}}));
 const form=doc.context.register(doc.context.stream('q /Nested Do Q',{Type:'XObject',Subtype:'Form',BBox:[0,0,4,4],Resources:{XObject:{Nested:nested}}}));
 doc.context.register(doc.context.obj({Type:'ExtGState',SMask:{S:'Luminosity',G:form}}));
 const result=await engine.processDocument(doc,{optimize:true,grayscale:true});
 assert.equal(result.changed,0);assert.equal(result.skipReasons.maskSource,2);assert.equal(result.skipReasons.mask,1);
 assert.equal(doc.context.lookup(maskRef),mask);assert.equal(mask.dict.lookup(name('ColorSpace')).asString(),'/DeviceGray');
 assert.equal(doc.context.lookup(groupImageRef),groupImage);assert.equal(parent.dict.lookup(name('SMask')),mask);
});

test('B&W uses one bit per pixel, preserves faint strokes, and pads odd-width rows correctly',async()=>{
 const width=65,height=33,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=8;y<25;y++)for(let x=10;x<14;x++){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=210;}
 const result=await engine.bitonal({getImageData(){return {data};}},width,height,180);
 const black=(x,y)=>!(result.bytes[y*Math.ceil(width/8)+(x>>3)]&(128>>(x&7)));
 assert.equal(result.bits,1);assert.equal(result.bytes.length,9*33);assert.equal(black(11,16),true);assert.equal(black(40,16),false);
 assert.equal(result.bytes[8]&127,127,'unused row bits stay white');
 await assert.rejects(engine.bitonal({getImageData(){return {data};}},width,height,180,AbortSignal.abort()),{name:'AbortError'});
});
