# Standalone OCR loading correction — 2026-09-14

The reported error was `importScripts` failing to load a `blob:null/...` script.
The standalone Paddle worker previously imported parent-created runtime Blob URLs,
then fetched parent-created model and WASM URLs. Local-file/opaque-origin loading
can fail at this boundary; HTTP-only checks had not covered it.

The standalone loader now bundles ORT, OpenCV, the engine and the worker together.
It transfers fresh model, dictionary and WASM byte buffers at initialization and
loads the ESM runtime from an embedded data URL. No parent Blob imports or model
fetches are used inside the standalone worker. SHA-256/size validation, cancellation
and timeouts remain enabled. The web path keeps its immutable asset URLs.

Verification:

- 309 Node tests pass, including a worker test where both `importScripts` and
  `fetch` throw, buffer transfer/retry checks and corrupt embedded-data rejection.
- `tests/create-local-ocr.cjs` exercises real Tesseract and Paddle inference on a
  Korean/English/numeric raster with external connections blocked.
- `tests/create-opaque-ocr.cjs` exercises two real Paddle OCR passes in a sandboxed
  `null` origin. Sandboxed HTTP loses WebCrypto, unlike ordinary local files; the
  test-only SHA-256 relay uses the secure parent's native WebCrypto. Module loading,
  model initialization and inference remain in the opaque worker. No hash checks
  are skipped and no browser security flags are changed.
- This is not a claim of testing the user's physical PC or its file-handler and
  enterprise-policy configuration. The customer's exact `importScripts` failure
  did not reproduce in the current browser sandbox (the original instead reached
  its missing-WebCrypto boundary); the failing import path has been removed.

`--web` on the local OCR fixture generator creates `.deploy/__qa-local-ocr.html`.
Remove that one test file after QA and before deploying.
