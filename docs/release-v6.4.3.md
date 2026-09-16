# v6.4.3 — Google Vision transport CPU fix

Large OCR pages could fail with an empty HTTP 503 response from the Cloudflare Worker. A synthetic 3,837,080-byte JPEG reproduced the production failure; its tail event reported `exceededCpu`, `cpuTime: 10`, and `Worker exceeded CPU time limit`. The screenshot's historical page-90 request was not independently recovered, so this is a confirmed reproducible failure mechanism rather than a matched historical trace.

## Change

- The web client sends the same JPEG as binary instead of creating and uploading base64 JSON. Consent and the selected language travel in explicit headers; same-origin checks, size caps, API-key isolation and the existing shared rate limit remain enforced.
- The Worker uses native base64 encoding and a fixed Google request envelope, avoiding large JSON parsing/stringifying on the new path. Google receives the same image bytes and `DOCUMENT_TEXT_DETECTION` with `builtin/latest`.
- Google's partial-response mask retains text, word boxes, confidence and reading breaks, while dropping duplicate text and unnecessary character geometry. Compact JSON is streamed under backpressure with an 8 MiB cap, cancellation and a 45-second upstream deadline. Strict normalization runs in the browser before publishing any result; the old JSON route uses that same validator for backward compatibility.
- Embedded Google errors are validated inside the retry loop. Quota and temporary gateway/connection errors retry the same encoded page up to three total attempts, with 10/30-second backoff and Retry-After respected. Access challenges, auth/billing failures and invalid results do not re-upload. The client retains a four-minute overall page deadline.
- Final errors include the HTTP status, attempt count and safe Cloudflare request ID when available. Completed-page reuse and partial-result publication are retained.

No document contents, keys or OCR results are logged or persisted. Cloud OCR remains absent from standalone HTML. No Cloudflare plan, billing setting, Google model or image-quality preset was changed.

## Verification

- The full serial suite passed 364 tests. Subsequent stricter malformed-response validation and shared-module build coverage passed all 32 affected tests, including one additional malformed-response regression.
- In the actual browser, the supplied 212-page PDF was rendered/encoded locally. **Google replies were mocked**; errors were injected at pages 60, 90 and 140. All 212 records completed with 215 requests, exact page mapping, unchanged images on retries, and zero full-document pdf-lib rebuilds. Repeating the run reused all records with zero additional uploads. A permanent failure on page 3 exposed and retained the two completed records.
- That local workflow took 169.01 seconds, including retry waits; maximum JPEG upload was 1,501,531 bytes. This is not a measurement of 212 real Google API calls or a recognition-accuracy benchmark.
- Real API checks used synthetic documents only. The formerly failing 3.84 MB image returned HTTP 200 on three preview calls (1.18, 4.97 and 6.45 seconds), each with complete text; two calls explicitly validated all 715 words / 4,159 characters. A smaller fixture also returned 44 words / 255 characters. The failed production call had returned no response body. Latency varies with Google and network conditions.
- Tests cover binary consent/language/JPEG/size rejection, exact byte preservation, raw-result geometry and financial punctuation, errors inside HTTP 200, rate-limit recovery, response size/timeout/cancellation after headers, legacy JSON compatibility, and exclusion from standalone builds.

## Operational limits

The existing 15 requests/minute shared Worker limiter and Google quotas still apply. A network outage, quota exhaustion or unsupported response can stop a run; completed results remain in the current tab. This release does not guarantee uninterrupted recognition on every document or device.

Already-open older tabs use the legacy JSON transport until reloaded. Save completed work before refreshing; the navigation warning does not persist the workspace or OCR cache.
