import {createWorkerSession} from './worker-client.mjs';
globalThis.PDFPaddle={
  model:'PaddleOCR-VL-1.5/community-Q4/ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4/browser-v1',
  session(language,signal,onProgress){return createWorkerSession(new URL(PADDLE_WORKER_FILE,import.meta.url),signal,onProgress);}
};
