/* PDF Studio Pro — local, image-only PDF processing. No page rasterization.
 * PDFLib 1.17.1 must be available as globalThis.PDFLib.
 * Work on a disposable export document: cancellation can leave earlier images changed.
 */
(function (root) {
  'use strict';

  const MAX_PIXELS = 16000000;
  const MAX_EDGE = 16384;
  const MAX_ENCODED_BYTES = 64 * 1024 * 1024;
  const REASONS = {
    mask: '투명도·마스크가 포함된 이미지는 원본을 유지했습니다.',
    color: 'RGB·회색조 이외의 색상 형식은 원본을 유지했습니다.',
    decode: '별도의 색상 변환 설정이 있는 이미지는 원본을 유지했습니다.',
    filter: '지원하지 않는 압축 형식의 이미지는 원본을 유지했습니다.',
    precision: '8비트 이외의 이미지는 원본을 유지했습니다.',
    dimensions: '1,600만 화소·한 변 16,384픽셀 제한을 넘거나 크기가 잘못된 이미지는 원본을 유지했습니다.',
    size: '이미지 데이터가 64MiB를 초과하여 원본을 유지했습니다.',
    predictor: '지원하지 않는 이미지 예측 설정은 원본을 유지했습니다.',
    inflater: '이 브라우저에서 압축을 해제할 수 없는 이미지는 원본을 유지했습니다.',
    jpeg: '색상·방향 정보가 있거나 안전하게 처리할 수 없는 JPEG는 원본을 유지했습니다.',
    decodeFailed: '안전하게 변환할 수 없는 이미지는 원본을 유지했습니다.',
    notSmaller: '재압축 후 용량이 줄지 않은 이미지는 원본을 유지했습니다.',
    noAction: '이미지 처리가 꺼져 있어 원본을 유지했습니다.'
  };

  function failure(code) { const error = new Error(code); error.reasonCode = code; return error; }
  function abortIfNeeded(signal) {
    if (signal && signal.aborted) {
      const error = new Error('PDF processing was cancelled.');
      error.name = 'AbortError';
      throw error;
    }
  }
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  const bounded = (value, fallback, min, max) => {
    const n = Number(value);
    return value == null || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, n));
  };
  function normalizeOptions(options) {
    const o = options || {};
    return {
      optimize: o.optimize !== false,
      maxDimension: Math.round(bounded(o.maxDimension, 2400, 256, 8192)),
      jpegQuality: bounded(o.jpegQuality, 0.82, 0.4, 0.95),
      grayscale: o.grayscale === true,
      contrast: bounded(o.contrast, 0, 0, 40),
      whitePoint: bounded(o.whitePoint, 255, 200, 255)
    };
  }
  const isEnhanced = o => o.grayscale || o.contrast > 0 || o.whitePoint < 255;
  function pdfValue(dict, key, lib) { return dict.lookup(lib.PDFName.of(key)); }
  function numberValue(value) { return value && typeof value.asNumber === 'function' ? value.asNumber() : undefined; }
  function nameValue(value) { return value && typeof value.asString === 'function' ? value.asString() : ''; }
  function present(dict, key, lib) {
    const value = pdfValue(dict, key, lib);
    return value != null && value !== lib.PDFNull;
  }

  function imageSpec(stream, lib) {
    const dict = stream.dict;
    if (['SMask', 'Mask', 'Alternates', 'OPI'].some(key => present(dict, key, lib)) ||
        nameValue(pdfValue(dict, 'ImageMask', lib)) === 'true' ||
        String(pdfValue(dict, 'ImageMask', lib)) === 'true' ||
        (numberValue(pdfValue(dict, 'SMaskInData', lib)) || 0) !== 0) throw failure('mask');
    if (present(dict, 'Decode', lib)) throw failure('decode');
    const width = numberValue(pdfValue(dict, 'Width', lib));
    const height = numberValue(pdfValue(dict, 'Height', lib));
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) throw failure('dimensions');
    if (numberValue(pdfValue(dict, 'BitsPerComponent', lib)) !== 8) throw failure('precision');
    const colorSpace = nameValue(pdfValue(dict, 'ColorSpace', lib));
    if (colorSpace !== '/DeviceRGB' && colorSpace !== '/DeviceGray') throw failure('color');
    const channels = colorSpace === '/DeviceRGB' ? 3 : 1;
    let filter = pdfValue(dict, 'Filter', lib);
    if (filter instanceof lib.PDFArray) {
      if (filter.size() !== 1) throw failure('filter');
      filter = filter.lookup(0);
      if (filter == null || filter === lib.PDFNull) throw failure('filter');
    }
    const compression = nameValue(filter);
    if (compression && compression !== '/DCTDecode' && compression !== '/FlateDecode') throw failure('filter');
    // Invalid non-name Filter objects must not accidentally be treated as raw raster.
    if (filter != null && filter !== lib.PDFNull && !compression) throw failure('filter');
    let params = pdfValue(dict, 'DecodeParms', lib);
    if (params instanceof lib.PDFArray) {
      if (params.size() !== 1) throw failure('predictor');
      params = params.lookup(0);
    }
    let predictor = 1;
    if (params != null && params !== lib.PDFNull) {
      if (compression !== '/FlateDecode' || !(params instanceof lib.PDFDict)) throw failure('predictor');
      for (const key of ['Predictor', 'Colors', 'Columns', 'BitsPerComponent']) {
        if (present(params, key, lib) && !Number.isInteger(numberValue(pdfValue(params, key, lib)))) throw failure('predictor');
      }
      predictor = numberValue(pdfValue(params, 'Predictor', lib)) ?? 1;
      const colors = numberValue(pdfValue(params, 'Colors', lib)) ?? 1;
      const columns = numberValue(pdfValue(params, 'Columns', lib)) ?? 1;
      const bits = numberValue(pdfValue(params, 'BitsPerComponent', lib)) ?? 8;
      if (predictor !== 1 && (colors !== channels || columns !== width || bits !== 8)) throw failure('predictor');
      if (![1, 2, 10, 11, 12, 13, 14, 15].includes(predictor)) throw failure('predictor');
      // Reject undocumented decode parameters rather than silently reinterpret them.
      if (params.keys().some(key => !['/Predictor', '/Colors', '/Columns', '/BitsPerComponent'].includes(nameValue(key)))) throw failure('predictor');
    }
    const bytes = stream.getContents();
    if (!bytes.length || bytes.length > MAX_ENCODED_BYTES) throw failure('size');
    return { width, height, channels, compression, predictor, bytes };
  }

  // Exact Skia/Chromium sRGB matrix/TRC profile (including the single APP2
  // segment header). Canvas-generated JPEGs carry this profile. Matching every
  // byte allows their ordinary DeviceRGB pixels without accepting arbitrary ICC.
  const canvasSRGB = Uint8Array.from('4943435f50524f46494c45000101000001c800000000043000006d6e74725247422058595a2007e00001000100000000000061637370000000000000000000000000000000000000000000000000000000010000f6d6000100000000d32d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000964657363000000f0000000247258595a00000114000000146758595a00000128000000146258595a0000013c00000014777470740000015000000014725452430000016400000028675452430000016400000028625452430000016400000028637072740000018c0000003c6d6c756300000000000000010000000c656e5553000000080000001c007300520047004258595a200000000000006fa2000038f50000039058595a2000000000000062990000b785000018da58595a2000000000000024a000000f840000b6cf58595a20000000000000f6d6000100000000d32d706172610000000000040000000266660000f2a700000d59000013d000000a5b00000000000000006d6c756300000000000000010000000c656e5553000000200000001c0047006f006f0067006c006500200049006e0063002e00200032003000310036'.match(/../g), n => parseInt(n,16));
  // Validate JPEG headers before a browser decoder allocates the source raster.
  function inspectJpeg(bytes, spec) {
    if (bytes[0] !== 255 || bytes[1] !== 216) throw failure('jpeg');
    let offset = 2;
    let frameFound = false, iccFound = false;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) throw failure('jpeg');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218) { if (!frameFound) throw failure('jpeg'); return; }
      if (marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) throw failure('jpeg');
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) throw failure('jpeg');
      const start = offset + 2;
      if ([192, 193, 194].includes(marker)) {
        if (frameFound || length < 8 + 3 * spec.channels || bytes[start] !== 8 || bytes[start + 5] !== spec.channels ||
            bytes[start + 1] * 256 + bytes[start + 2] !== spec.height ||
            bytes[start + 3] * 256 + bytes[start + 4] !== spec.width) throw failure('jpeg');
        frameFound = true;
      } else if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        throw failure('jpeg');
      }
      // Browser EXIF orientation / ICC color handling can differ from PDF rendering.
      // Preserve these files instead of risking a changed orientation or color profile.
      if (marker === 225 && length >= 8 && bytes[start] === 69 && bytes[start + 1] === 120 &&
          bytes[start + 2] === 105 && bytes[start + 3] === 102) throw failure('jpeg');
      if (marker === 226 && length >= 14 && bytes[start] === 73 && bytes[start + 1] === 67 && bytes[start + 2] === 67) {
        if (iccFound || spec.channels !== 3 || length-2 !== canvasSRGB.length ||
            !canvasSRGB.every((v,i) => bytes[start+i] === v)) throw failure('jpeg');
        iccFound = true;
      }
      offset += length;
    }
    throw failure('jpeg');
  }

  async function inflateBounded(bytes, length, signal) {
    if (typeof root.DecompressionStream !== 'function') throw failure('inflater');
    const reader = new Blob([bytes]).stream().pipeThrough(new root.DecompressionStream('deflate')).getReader();
    const output = new Uint8Array(length);
    let offset = 0;
    const cancel = () => { reader.cancel().catch(() => {}); };
    if (signal) signal.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        abortIfNeeded(signal);
        const { value, done } = await reader.read();
        abortIfNeeded(signal);
        if (done) break;
        if (offset + value.length > length) throw failure('decodeFailed');
        output.set(value, offset);
        offset += value.length;
      }
      if (offset !== length) throw failure('decodeFailed');
      return output;
    } finally {
      if (signal) signal.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  function paeth(a, b, c) {
    const p = a + b - c;
    const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  }
  async function undoPredictor(data, spec, signal) {
    const { width, height, channels, predictor } = spec;
    const stride = width * channels;
    if (predictor === 1) return data;
    for (let row = 0; row < height; row++) {
      if (row % 64 === 0) { abortIfNeeded(signal); await pause(); }
      const out = row * stride;
      if (predictor === 2) {
        for (let x = channels; x < stride; x++) data[out + x] = (data[out + x] + data[out + x - channels]) & 255;
        continue;
      }
      const input = row * (stride + 1);
      const filter = data[input];
      if (filter > 4) throw failure('predictor');
      for (let x = 0; x < stride; x++) {
        const left = x >= channels ? data[out + x - channels] : 0;
        const up = row > 0 ? data[out - stride + x] : 0;
        const corner = row > 0 && x >= channels ? data[out - stride + x - channels] : 0;
        const add = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up :
          filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, corner);
        data[out + x] = (data[input + 1 + x] + add) & 255;
      }
    }
    return data.subarray(0, stride * height);
  }

  function newCanvas(width, height) {
    const canvas = root.document ? root.document.createElement('canvas') : new root.OffscreenCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  function canvasContext(canvas) {
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw failure('decodeFailed');
    return context;
  }
  async function loadJpeg(spec, signal) {
    inspectJpeg(spec.bytes, spec);
    const blob = new Blob([spec.bytes], { type: 'image/jpeg' });
    if (typeof root.createImageBitmap === 'function') {
      const bitmap = await root.createImageBitmap(blob, { imageOrientation: 'none', colorSpaceConversion: 'none' });
      if ((signal && signal.aborted) || bitmap.width !== spec.width || bitmap.height !== spec.height) {
        bitmap.close();
        abortIfNeeded(signal);
        throw failure('jpeg');
      }
      return bitmap;
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new root.Image();
      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (signal) signal.removeEventListener('abort', cancel);
        image.onload = image.onerror = null;
      };
      const cancel = () => { cleanup(); image.src = ''; const e = new Error('PDF processing was cancelled.'); e.name = 'AbortError'; reject(e); };
      image.onload = () => {
        cleanup();
        if (image.naturalWidth !== spec.width || image.naturalHeight !== spec.height) reject(failure('jpeg'));
        else resolve(image);
      };
      image.onerror = () => { cleanup(); reject(failure('decodeFailed')); };
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      if (signal && signal.aborted) cancel();
      else image.src = url;
    });
  }
  async function rawCanvas(spec, signal) {
    const stride = spec.width * spec.channels;
    const expected = spec.height * (stride + (spec.predictor >= 10 ? 1 : 0));
    let data;
    if (spec.compression === '/FlateDecode') data = await inflateBounded(spec.bytes, expected, signal);
    else {
      if (spec.bytes.length !== expected) throw failure('decodeFailed');
      data = spec.bytes;
    }
    data = await undoPredictor(data, spec, signal);
    const canvas = newCanvas(spec.width, spec.height);
    try {
      const context = canvasContext(canvas);
      // Bounded strips avoid allocating a second full-size RGBA raster in JavaScript.
      for (let top = 0; top < spec.height; top += 64) {
        abortIfNeeded(signal);
        const rows = Math.min(64, spec.height - top);
        const strip = context.createImageData(spec.width, rows);
        for (let p = 0, source = top * stride; p < strip.data.length; p += 4, source += spec.channels) {
          strip.data[p] = data[source];
          strip.data[p + 1] = data[source + (spec.channels === 3 ? 1 : 0)];
          strip.data[p + 2] = data[source + (spec.channels === 3 ? 2 : 0)];
          strip.data[p + 3] = 255;
        }
        context.putImageData(strip, 0, top);
        await pause();
      }
      return canvas;
    } catch (error) { canvas.width = canvas.height = 1; throw error; }
  }
  async function enhance(context, width, height, options, signal) {
    const factor = 259 * (options.contrast + 255) / (255 * (259 - options.contrast));
    const whiteScale = 255 / options.whitePoint;
    const map = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) map[v] = factor * (Math.min(255, v * whiteScale) - 128) + 128;
    for (let y = 0; y < height; y += 64) {
      abortIfNeeded(signal);
      const strip = context.getImageData(0, y, width, Math.min(64, height - y));
      const pixels = strip.data;
      for (let p = 0; p < pixels.length; p += 4) {
        if (options.grayscale) {
          const gray = Math.round(0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2]);
          pixels[p] = pixels[p + 1] = pixels[p + 2] = map[gray];
        } else {
          pixels[p] = map[pixels[p]]; pixels[p + 1] = map[pixels[p + 1]]; pixels[p + 2] = map[pixels[p + 2]];
        }
      }
      context.putImageData(strip, 0, y);
      await pause();
    }
  }
  async function encode(canvas, quality) {
    const blob = typeof canvas.convertToBlob === 'function'
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
      : await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.type !== 'image/jpeg' || blob.size > MAX_ENCODED_BYTES) throw failure('decodeFailed');
    return new Uint8Array(await blob.arrayBuffer());
  }
  async function transform(spec, options, signal) {
    let source, target;
    try {
      source = spec.compression === '/DCTDecode' ? await loadJpeg(spec, signal) : await rawCanvas(spec, signal);
      abortIfNeeded(signal);
      const scale = options.optimize ? Math.min(1, options.maxDimension / Math.max(spec.width, spec.height)) : 1;
      const width = Math.max(1, Math.round(spec.width * scale));
      const height = Math.max(1, Math.round(spec.height * scale));
      target = newCanvas(width, height);
      const context = canvasContext(target);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, 0, 0, width, height);
      if (isEnhanced(options)) await enhance(context, width, height, options, signal);
      abortIfNeeded(signal);
      // Enhancement alone still needs an image encoding; use a high-quality JPEG.
      const bytes = await encode(target, options.optimize ? options.jpegQuality : 0.95);
      abortIfNeeded(signal);
      return { bytes, width, height };
    } finally {
      if (source && typeof source.close === 'function') source.close();
      else if (source && typeof source.getContext === 'function') source.width = source.height = 1;
      if (target) target.width = target.height = 1;
    }
  }

  async function processDocument(doc, options, callbacks) {
    const lib = root.PDFLib;
    if (!lib || !doc || !doc.context) throw new Error('PDFLib and a loaded PDFDocument are required.');
    const settings = normalizeOptions(options);
    const { onProgress, signal } = callbacks || {};
    abortIfNeeded(signal);
    // PDFLib defers new image/font embedding until save/flush. Include newly inserted
    // image assets as well as the streams loaded from the original PDF.
    if (typeof doc.flush === 'function') await doc.flush();
    abortIfNeeded(signal);
    const images = doc.context.enumerateIndirectObjects().filter(([, object]) =>
      object instanceof lib.PDFRawStream && nameValue(pdfValue(object.dict, 'Subtype', lib)) === '/Image');
    const report = { imageCount: images.length, processed: 0, changed: 0, skipped: 0,
      originalImageBytes: 0, resultImageBytes: 0, skipReasons: {}, notes: [] };
    for (const [, stream] of images) report.originalImageBytes += stream.getContents().length;
    report.resultImageBytes = report.originalImageBytes;
    const skip = code => {
      report.skipped++;
      report.skipReasons[code] = (report.skipReasons[code] || 0) + 1;
    };
    if (onProgress) onProgress({ completed: 0, total: images.length, changed: 0 });
    for (let i = 0; i < images.length; i++) {
      abortIfNeeded(signal);
      const [ref, stream] = images[i];
      try {
        if (!settings.optimize && !isEnhanced(settings)) throw failure('noAction');
        const spec = imageSpec(stream, lib);
        const result = await transform(spec, settings, signal);
        report.processed++;
        if (!isEnhanced(settings) && result.bytes.length >= spec.bytes.length) {
          // A supported image was evaluated, but kept intact because recompression did not help.
          skip('notSmaller');
        } else {
          const dict = stream.dict.clone(doc.context);
          const set = (key, value) => dict.set(lib.PDFName.of(key), value);
          set('Width', lib.PDFNumber.of(result.width));
          set('Height', lib.PDFNumber.of(result.height));
          set('BitsPerComponent', lib.PDFNumber.of(8));
          set('ColorSpace', lib.PDFName.of('DeviceRGB'));
          set('Filter', lib.PDFName.of('DCTDecode'));
          set('Length', lib.PDFNumber.of(result.bytes.length));
          dict.delete(lib.PDFName.of('DecodeParms'));
          dict.delete(lib.PDFName.of('DL'));
          // Assign to the SAME reference: all pages and form XObjects keep their placements,
          // text, OCR layers, annotations, and vector content; no stale image object is added.
          doc.context.assign(ref, lib.PDFRawStream.of(dict, result.bytes));
          report.changed++;
          report.resultImageBytes += result.bytes.length - spec.bytes.length;
        }
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        skip(error && error.reasonCode || 'decodeFailed');
      }
      if (onProgress) onProgress({ completed: i + 1, total: images.length, changed: report.changed });
      await pause();
    }
    abortIfNeeded(signal);
    report.notes = Object.keys(report.skipReasons).map(code => REASONS[code] || REASONS.decodeFailed);
    if (!images.length) report.notes.push('처리할 이미지가 없습니다. 텍스트와 벡터는 원본을 유지했습니다.');
    if (isEnhanced(settings) && report.changed) report.notes.push('보정 후 용량이 늘어날 수 있습니다. 기존 텍스트·OCR 레이어는 유지했습니다.');
    return report;
  }

  root.PDFPro = Object.freeze({ processDocument });
  // Pure helpers are exported only in Node for focused regression tests.
  if (typeof module !== 'undefined' && module.exports) module.exports = {
    processDocument, normalizeOptions, imageSpec, inspectJpeg, undoPredictor, inflateBounded
  };
})(globalThis);
