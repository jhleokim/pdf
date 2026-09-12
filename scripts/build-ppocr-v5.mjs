import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, dirname, extname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = resolve(root, '.deploy/ocr/ppocr-v5');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const PPOCRV5_MODEL = 'PP-OCRv5/korean-mobile/5c6f574b8e2230adf4287b33e736d71b9fabd28e/det-e6f4fa85/browser-v1';
const sources = {
  'ort.js': 'node_modules/onnxruntime-web/dist/ort.wasm.min.js',
  'ort-wasm-simd-threaded.mjs': 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm': 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
  'opencv.js': 'node_modules/@techstark/opencv-js/dist/opencv.js',
  'engine.js': 'src/ppocr-v5/engine.js',
  'worker.js': 'src/ppocr-v5/worker.js',
  'det.onnx': 'work/ppocr-v5-models/det.onnx',
  'rec.onnx': 'work/ppocr-v5-models/rec.onnx',
  'dict.json': 'work/ppocr-v5-models/dict.json'
};
const licenses = {
  'LICENSE-PaddleOCR.txt': 'experiments/ppocr-v5-browser/LICENSE-PaddleOCR',
  'LICENSE-OpenCV.txt': 'experiments/ppocr-v5-browser/LICENSE-OpenCV',
  'LICENSE-ONNXRuntime.txt': 'vendor/paddle/licenses/onnxruntime-1.29.0-LICENSE.txt',
  'ONNXRuntime-ThirdPartyNotices.txt': 'vendor/paddle/licenses/onnxruntime-1.29.0-ThirdPartyNotices.txt'
};

export async function buildPPOCRV5Assets({outputDirectory = defaultOutput} = {}) {
  if (!existsSync(resolve(root, sources['opencv.js']))) throw Error('Install the pinned OpenCV dependency first: npm ci');
  // The preparer verifies the official model/YAML size and SHA-256 before use,
  // then builds the Korean dictionary from that verified YAML.
  execFileSync(process.execPath, ['experiments/ppocr-v5-browser/prepare.mjs'], {cwd: root, stdio: 'pipe'});
  mkdirSync(outputDirectory, {recursive: true});
  const assets = {};
  function write(name, bytes) {
    const hash = sha(bytes), extension = extname(name), file = basename(name, extension) + '-' + hash.slice(0, 16) + extension;
    assets[name] = {file, bytes: bytes.length, sha256: hash};
    writeFileSync(resolve(outputDirectory, file), bytes);
  }
  for (const [name, source] of Object.entries(sources)) write(name, readFileSync(resolve(root, source)));
  const adapter = readFileSync(resolve(root, 'src/ppocr-v5/adapter.js'), 'utf8').replace('/* PPV5_ASSETS */ {}', JSON.stringify(assets));
  write('adapter.js', Buffer.from(adapter));
  for (const [name, source] of Object.entries(licenses)) writeFileSync(resolve(outputDirectory, name), readFileSync(resolve(root, source)));
  const metadata = {schemaVersion: 1, model: PPOCRV5_MODEL, runtimeURL: '/ocr/ppocr-v5/' + assets['adapter.js'].file,
    runtimeSHA256: assets['adapter.js'].sha256, modelBytes: assets['det.onnx'].bytes + assets['rec.onnx'].bytes,
    totalBytes: Object.values(assets).reduce((sum, asset) => sum + asset.bytes, 0), assets};
  writeFileSync(resolve(outputDirectory, 'manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log('Built PP-OCRv5 browser runtime; official models ' + metadata.modelBytes + ' bytes.');
  return metadata;
}

/** Returns JavaScript source for a <script> block. Call buildPPOCRV5Assets first.
 * Both modes load only when PDFPaddleLoad is called; standalone embeds all bytes.
 * The adapter itself is loaded with a regular script, not an ES module import. */
export function getPPOCRV5Bootstrap({standalone = false, outputDirectory = defaultOutput} = {}) {
  const metadata = JSON.parse(readFileSync(resolve(outputDirectory, 'manifest.json'), 'utf8'));
  if (metadata.model !== PPOCRV5_MODEL || !/^\/ocr\/ppocr-v5\/adapter-[a-f0-9]{16}\.js$/.test(metadata.runtimeURL)) throw Error('PP-OCRv5 build manifest mismatch');
  let setup = 'const runtimeURL=' + JSON.stringify(metadata.runtimeURL) + ';';
  if (standalone) {
    const mime = name => name.endsWith('.wasm') ? 'application/wasm' : /\.(?:m?js)$/.test(name) ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    const embedded = Object.fromEntries(Object.entries(metadata.assets).map(([name, asset]) => {
      const bytes = readFileSync(resolve(outputDirectory, asset.file));
      if (bytes.length !== asset.bytes || sha(bytes) !== asset.sha256) throw Error('PP-OCRv5 standalone integrity mismatch: ' + name);
      return [name, {mime: mime(name), data: bytes.toString('base64')}];
    }));
    setup = 'const embedded=' + JSON.stringify(embedded) + ';let urls;function assetURLs(){if(urls)return urls;urls={};for(const [name,asset]of Object.entries(embedded)){const raw=atob(asset.data),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);urls[name]=URL.createObjectURL(new Blob([bytes],{type:asset.mime}));}globalThis.PDFPaddleV5Assets=urls;return urls;}';
  }
  return '(function(){' + setup + 'globalThis.PDFPaddleLoad=()=>globalThis.PDFPaddleReady??=new Promise((resolve,reject)=>{if(globalThis.PDFPaddleV5){resolve(globalThis.PDFPaddleV5);return;}const script=document.createElement("script");let timer=setTimeout(()=>{script.remove();reject(new Error("Paddle 엔진 준비 시간이 초과됐습니다. 다시 시도해 주세요."));},30000);script.onload=()=>{clearTimeout(timer);script.remove();globalThis.PDFPaddleV5?resolve(globalThis.PDFPaddleV5):reject(new Error("Paddle 엔진을 준비하지 못했습니다."));};script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error("Paddle 엔진을 불러오지 못했습니다. 연결을 확인해 주세요."));};script.src=' + (standalone ? 'assetURLs()["adapter.js"]' : 'runtimeURL') + ';document.head.append(script);}).catch(error=>{globalThis.PDFPaddleReady=null;throw error;});})();';
}

export function getPPOCRV5Licenses() {
  return Object.entries(licenses).map(([name, file]) => name + '\n' + readFileSync(resolve(root, file), 'utf8')).join('\n\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPPOCRV5Assets();

