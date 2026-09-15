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

## Hana2.0 Regular and Bold

Copyright Hana Financial Group. Official font family released in March 2023. The original Windows TTF files are bundled unchanged (lossless zlib compression) and embedded in full only when selected for document text. These font assets retain the separate Hana font terms; they are not relicensed under AGPL. Personal and business commercial use is free; modification, resale, and CI/BI creation are prohibited by the publisher's terms.

- Official distribution and terms: https://www.hanafn.com/hfm/mnu/aboutus/hanaFnCi.do
- Original archive: https://www.hanafn.com/download/10054025/crossDownload.do
- Retrieved 2026-09-16; archive and asset checksums: `vendor/markup/manifest.json`.
- Included terms: `vendor/markup/Hana2-LICENSE.txt`.

## Tesseract GlyphLessFont

Tesseract's 572-byte `pdf.ttf`, Apache-2.0, is embedded as `GlyphLessFont` in OCR search layers. It supplies valid blank glyphs for invisible text; the PDF ToUnicode map retains the recognized Unicode text. A single font program is shared by all search-font resources in each output document.

- Source: https://github.com/tesseract-ocr/tessconfigs/blob/3decf1c8252ba6dbeef0bf908f4b0aab7f18d113/pdf.ttf
- License: `vendor/markup/LICENSE-GlyphLessFont`; checksums in `vendor/markup/manifest.json`.

## Rebuild PDF Studio

Use Node.js 22 or later, run `npm ci`, `npm run build`, `npm run build:standalone`, and `npm test`. The first build retrieves and verifies the pinned public OCR models if absent. No end-user document is used by the build. `node scripts/build-deploy.mjs` prepares hosted assets. Secrets belong to Cloudflare bindings and are not required for local OCR or redaction.
