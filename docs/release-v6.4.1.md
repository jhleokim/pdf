# v6.4.1 — OCR continuity for large documents

Google Vision previously ended the entire run at the first HTTP 429, temporary service error or connection failure. The Worker currently shares a `pdf-vision-ocr` rate-limit key across callers, with a configured 15 requests per 60 seconds. This change preserves that limit and adds bounded client retries with a visible countdown, instead of removing the limit. Successful pages are not uploaded again. Image encoding is reused across retries of the same page.

Vision has at most three attempts per page, a 60-second transport deadline per attempt and a four-minute total recognition deadline including waits. A server wait over two minutes is returned to the user rather than shortened. Invalid OCR, image, authentication and billing failures are not retried. Cancellation interrupts waits and requests. OCR preparation retains its separate two-minute limit.

Unedited source pages now render directly from the existing PDF.js document, avoiding a full pdf-lib parse/copy/save cycle per page. Page caches are cleaned after use. Edited pages, masks, rotations and enabled image/page transformations retain the existing processing pipeline. The original PDF and extracted text remain local unless the user explicitly consents to cloud OCR.

If a run ends with a permanent error or cancellation, newly completed results are published in the correction UI and retained as in-tab checkpoints. The error includes the failing page and provider code. The result is not presented as a complete document, and PDF embedding still requires user acceptance. Closing or reloading the tab does not preserve these checkpoints.

## Validation

- User-provided scan: 108,442,211 bytes; 212 pages. Pages around 60 and 140 rendered successfully in a separate local MuPDF inspection.
- Actual 212-page browser import, rendering and JPEG encoding, with mocked Google responses: 137.41 seconds. This is **not** live Vision OCR latency or an OCR accuracy benchmark.
- Injected HTTP 429 at pages 60 and 140: 212 correctly ordered results, 214 requests; retry payloads identical. Largest base64 image 2,002,044 bytes, below the app's 8 MiB cap. Full-document pdf-lib preparations: zero for unedited pages.
- Repeating recognition reused all completed pages without requests. A permanent error on page 3 exposed completed pages 1 and 2 plus page/error-code details.
- Unit tests cover real 60-second quota waits using a simulated clock, retry exhaustion, network failures, cancellation, invalid results, authentication and source-page safety guards.
- Browser regional-redaction/searchable-text regression: 38 checks passed. The source-page optimization does not bypass masking.
- Offline opaque-origin redaction/B&W regression: 34 checks passed, with no HTTP requests after the HTML loaded.
- Full unit suite: 352 checks passed with serial execution; the subsequently added HTML-authentication retry guard passed its focused suite. The initial parallel run hit an existing corrupt-WASM initialization test race; both the isolated rerun and complete serial run passed.

No production document upload, paid Google request, quota change or production deployment was performed for this investigation. Without the user's original failing response/log, quota and transient request errors remain the leading explanation, not a confirmed diagnosis of each historical stop. This release is a local fix for those verified failure paths.
