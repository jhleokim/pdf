import {writeFileSync} from 'node:fs';
import {buildPDFStudioExperiment} from './build-pdf-studio-experiment.mjs';

const runtimeMarkup=`<script type="importmap">{"imports":{"onnxruntime-web/webgpu":"./node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs","onnxruntime-common":"./node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs"}}</script>
<script>globalThis.PDFPaddleReady=import('./paddle-session.mjs');globalThis.PDFPaddleReady.catch(()=>{});</script>`;
const result=buildPDFStudioExperiment({runtimeMarkup});
if(process.argv.includes('--qa'))result.html=result.html.replace('</body>','<script type="module" src="./dev-qa.mjs"></script></body>');
writeFileSync(new URL('./pdf-studio-paddle-dev.html',import.meta.url),result.html);
writeFileSync(new URL('./pdf-studio-paddle-dev.manifest.json',import.meta.url),JSON.stringify(result.metadata,null,2));
console.log(JSON.stringify(result.metadata));
