/* PDF Studio adapter for the pinned Korean PP-OCRv5 mobile models.
 * Recognition runs in a disposable WASM worker. No document leaves this device. */
(function (root) {
  'use strict';
  const MODEL = 'PP-OCRv5/korean-mobile/5c6f574b8e2230adf4287b33e736d71b9fabd28e/det-e6f4fa85/browser-v1';
  const buildAssets = /* PPV5_ASSETS */ {};
  const scriptURL = root.document?.currentScript?.src;
  const baseURL = scriptURL && /^https?:/.test(scriptURL) ? new URL('.', scriptURL).href : new URL('/ocr/ppocr-v5/', root.location?.href || 'http://localhost/').href;
  const abortError = () => new DOMException('인식을 취소했습니다.', 'AbortError');
  const clamp = n => Math.max(0, Math.min(1, n));

  function normalizeResult(result) {
    if (!result || !Array.isArray(result.words) || !Number.isFinite(result.width) || result.width <= 0 || !Number.isFinite(result.height) || result.height <= 0) throw new Error('Paddle 인식 결과 형식이 올바르지 않습니다.');
    const words = result.words.map(word => {
      if (typeof word.text !== 'string' || !word.text.trim() || !Array.isArray(word.box) || word.box.length !== 4 || !word.box.every(Number.isFinite)) throw new Error('Paddle 글줄 위치를 확인하지 못했습니다.');
      const box = word.box.map(clamp);
      if (box[2] <= box[0] || box[3] <= box[1]) throw new Error('Paddle 글줄 위치가 올바르지 않습니다.');
      const confidence = Number.isFinite(word.confidence) ? clamp(word.confidence) * 100 : 0;
      const quad = Array.isArray(word.quad) && word.quad.length === 4 && word.quad.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ? word.quad.map(([x, y]) => [clamp(x / result.width), clamp(y / result.height)]) : undefined;
      return {text: word.text.normalize('NFC'), box, confidence, uncertain: confidence < 70, separator: '\n', ...(quad ? {quad} : {})};
    });
    return {text: words.map(word => word.text).join('\n'), words,
      confidence: words.length ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length : 0,
      source: 'paddle-v5', model: MODEL, status: 'complete', granularity: 'line',
      canEmbed: words.length > 0, elapsedMs: result.elapsedMs, detected: result.detected,
      backend: 'wasm-single-thread', columns: result.columns};
  }

  async function createSession(signal, onProgress, options = {}) {
    signal?.throwIfAborted();
    const WorkerImpl = options.WorkerImpl || root.Worker;
    if (!WorkerImpl) throw new Error('이 브라우저에서는 Paddle 작업 스레드를 사용할 수 없습니다. Tesseract를 선택해 주세요.');
    const assets = options.assets || buildAssets;
    const urls = options.urls || root.PDFPaddleV5Assets || Object.fromEntries(Object.entries(assets).map(([name, item]) => [name, new URL(item.file, baseURL).href]));
    if (!urls['worker.js']) throw new Error('Paddle 엔진 파일을 준비하지 못했습니다. 페이지를 새로 열어 주세요.');
    const worker = new WorkerImpl(urls['worker.js']);
    let closed = false, pending = null, sequence = 0, timer;
    const notify = message => {try {onProgress?.(message);} catch {/* A status view must not strand the worker. */}};
    const terminate = (error = abortError()) => {
      if (closed) return;
      closed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      worker.terminate(); const task = pending; pending = null; task?.reject(error);
    };
    const abort = () => terminate(signal.reason || abortError());
    worker.onmessage = ({data}) => {
      if (closed || !pending || data.id !== pending.id) return;
      if (data.type === 'progress') {notify(data.progress); return;}
      if (data.type !== 'result') {
        terminate(Object.assign(new Error(data.error?.message || 'Paddle 인식을 완료하지 못했습니다.'), {code: data.error?.code || 'PPV5_FAILED'})); return;
      }
      clearTimeout(timer); const task = pending; pending = null; task.resolve(data.result);
    };
    worker.onerror = event => {event.preventDefault?.(); terminate(Object.assign(new Error('Paddle 작업 스레드를 실행하지 못했습니다. Tesseract를 선택해 주세요.'), {code: 'PPV5_WORKER_FAILED'}));};
    worker.onmessageerror = () => terminate(new Error('Paddle 결과를 전달하지 못했습니다. 다시 시도해 주세요.'));
    signal?.addEventListener('abort', abort, {once: true});
    function request(type, payload = {}, transfer = []) {
      return new Promise((resolve, reject) => {
        if (closed) {reject(signal?.aborted ? signal.reason : abortError()); return;}
        if (pending) {reject(new Error('이전 페이지 인식이 아직 진행 중입니다.')); return;}
        const id = ++sequence;
        pending = {id, resolve, reject};
        timer = setTimeout(() => terminate(Object.assign(new Error((type === 'init' ? 'Paddle 모델 준비' : 'Paddle 페이지 인식') + ' 시간이 초과되어 작업을 종료했습니다. 완료된 페이지는 유지됩니다. Tesseract를 선택하거나 다시 시도해 주세요.'), {code: 'PPV5_TIMEOUT'})), type === 'init' ? (options.initTimeout ?? 180000) : (options.pageTimeout ?? 180000));
        try {worker.postMessage({id, type, ...payload}, transfer);} catch (error) {terminate(error);}
      });
    }
    try {
      if (signal?.aborted) abort();
      await request('init', {urls, assets});
    } catch (error) {terminate(error); throw error;}
    return {model: MODEL,
      async recognize(canvas) {
        signal?.throwIfAborted();
        if (closed) throw abortError();
        if (!Number.isSafeInteger(canvas?.width) || !Number.isSafeInteger(canvas?.height) || canvas.width < 1 || canvas.height < 1 || canvas.width * canvas.height > 40000000) throw new Error('인식할 페이지 이미지 크기를 확인해 주세요.');
        // Match the verified trial resolution; normalized boxes retain their page positions.
        const scale = Math.min(1, 2367 / Math.max(canvas.width, canvas.height));
        let input = canvas;
        if (scale < 1) {
          input = new root.OffscreenCanvas(Math.round(canvas.width * scale), Math.round(canvas.height * scale));
          input.getContext('2d').drawImage(canvas, 0, 0, input.width, input.height);
        }
        let pixels;
        try {pixels = input.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, input.width, input.height);} finally {if (input !== canvas) input.width = input.height = 0;}
        const result = await request('recognize', {width: pixels.width, height: pixels.height, pixels: pixels.data.buffer, size: 1536}, [pixels.data.buffer]);
        signal?.throwIfAborted(); return normalizeResult(result);
      }, async close() {terminate();}, terminate() {terminate();}
    };
  }

  root.PDFPaddleV5 = {model: MODEL, session(language, signal, onProgress, layout) {return createSession(signal, onProgress);}};
  if (typeof module !== 'undefined' && module.exports) module.exports = {MODEL, normalizeResult, createSession};
})(globalThis);
