# Third-party notices

PDF Studio project code is licensed under GNU AGPL-3.0-or-later. Third-party packages and assets retain their original copyright and license notices.

## MuPDF 1.28.1

Copyright © Artifex Software, Inc. Licensed under GNU AGPL v3 or later for this distribution; no commercial license is included. The complete license is in LICENSE and the application's version dialog.

- Pinned npm package: `mupdf@1.28.1`, integrity recorded in `package-lock.json`.
- Corresponding upstream source (npm gitHead): https://github.com/ArtifexSoftware/mupdf/tree/20061bd45183f5a2bff8f43675e4da91e5ac2901
- Source including WebAssembly build scripts: `platform/wasm` at that revision. Retrieve its submodules recursively when building upstream MuPDF; third-party source licenses are retained there.
- Official source repository: https://cgit.ghostscript.com/mupdf.git/
- Official licensing information: https://mupdf.readthedocs.io/en/latest/license.html
- PDF Studio adapter source: `src/privacy-native-worker.js`, `src/privacy-content.mjs`, `src/privacy-native.js`, `src/privacy-export.js`; packing instructions: `scripts/build-privacy.mjs`.

All processing happens in the browser. Opening a source/license link is an explicit navigation; merely using local redaction makes no request to Artifex or GitHub. Input documents, recognition results and credentials are not included in the source release.

## Existing components

PDF.js (Apache-2.0), pdf-lib (MIT), fontkit (MIT), Nanum Gothic/Myeongjo (SIL Open Font License), Tesseract.js and core (Apache-2.0), PP-OCRv5 models (Apache-2.0), OpenCV and ONNX Runtime retain the notices already included in the application and vendor directories. See `vendor/ocr`, `vendor/markup`, `vendor/paddle/licenses`, and `experiments/ppocr-v5-browser`. Browser and standalone builds preserve these notices.

## Rebuild PDF Studio

Use Node.js 22 or later, run `npm ci`, `npm run build`, `npm run build:standalone`, and `npm test`. The first build retrieves and verifies the pinned public OCR models if absent. No end-user document is used by the build. `node scripts/build-deploy.mjs` prepares hosted assets. Secrets belong to Cloudflare bindings and are not required for local OCR or redaction.
