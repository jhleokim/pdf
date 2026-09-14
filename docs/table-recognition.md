# Local table recognition and correction

The existing OCR providers are unchanged. In Pro → Text recognition → Advanced → Correct recognition results, the **Table** view analyzes the current page and reuses the OCR word/line coordinates. The same correction view is built into the OCR lab and both standalone HTML builds.

## Accuracy contract

- Detect orthogonal bordered grids and preserve empty cells. Infer a merged cell only when missing interior borders describe a rectangle.
- Flag empty OCR cells when raster evidence suggests visible writing or a mark inside them, excluding grid borders and tiny dust. This can also indicate a stamp or signature, so it requests original comparison instead of inventing text. Keep the warning across reopening until the cell is corrected.
- Keep the original image, OCR text, and OCR geometry unchanged by table edits. Table text and topology are separate `record.tables` data used by table copy/TSV/JSON export. Searchable-PDF text correction remains in the line view.
- Assign words by overlap with cells. A PP-OCRv5 line spanning multiple cells is never divided by character count or guessed spaces. Its full original text remains visible until the user explicitly confirms it was reflected in the appropriate cells. Changing affected cell text or geometry invalidates that confirmation.
- Preserve small punctuation inside its text row. Vision can provide a comma, decimal point, currency sign, or date hyphen as a separate short ink box. Attach these to nearby full-height source words before ordering the row, so a value such as `1,250,000` does not become `1250000` followed by commas on another line. Preserve the original text, separators, and coordinates; do not infer missing digits.
- Preserve edited cell text during boundary movement and flag changed OCR membership. Merging and splitting must cover every grid slot exactly once. Splitting an edited merged cell requires restoring its OCR text first; a structural undo is available.
- Require original comparison before table export. Manual boundaries and uncertain/merged cells remain reviewable. A checked review box represents a user's review, not an accuracy guarantee.
- Refuse oversized/ambiguous geometry with an actionable message. Text-only layouts and heavily skewed or fragmented rules require page correction or manual region/row/column setup. A complete semantic model for all borderless layouts is not provided.
- Clipboard HTML preserves row/column spans; TSV stores merged text at the top-left slot. Spreadsheet formula starters are neutralized, numeric negative amounts are retained, and HTML requests text cell formatting. For TSV imports, select text columns to avoid spreadsheet conversion of account numbers, leading zeros, or long identifiers. Live Excel interoperability still needs target-office validation.

## Browser resource policy

- Table structure has no external API call, GPU requirement, model download, or new dependency. A disposable Blob worker runs the bounded image/geometry analysis.
- Analyze one page only when requested. Raster long edge is at most 1600 pixels; transfer its RGBA buffer once to the worker. The maximum raster buffer alone is 10.24 MB (an A4-like page is smaller); this is **not** a claim about total application memory.
- Bound work to 600 primitive grid slots, 12 tables per page, 80 boundaries per table, and 20,000 OCR regions per page. Raster rule/crossing candidate counts are also bounded. Limits produce messages, not silent truncation.
- A 10-second structure deadline, cancellation, page/view changes, and dialog close terminate work. Release temporary images and original preview copies promptly. Table results retain text/coordinates, not extra full-page images.
- Optional cell OCR uses a lazily created local session reused within the correction dialog, with a 90-second deadline. Closing/canceling rejects late results and releases the session. PP-OCRv5 pages use PP-OCRv5; other pages use local Tesseract. Google Vision is never called implicitly for cell retries.
- Cell OCR returns a proposal beside the existing value. The user must accept it before any cell text changes; empty results leave the old text intact. In the real fixture test, PP-OCRv5 cell retry omitted the first digit of `1,250,000`, which is why retries must not automatically replace an already correct amount.
- This distributes additional structure work across staff devices. It does not establish 200-user concurrent capacity or remove existing lab page limits. Google Vision requests continue to use the existing cloud quota/rate-limit configuration.

## Validation

Generate the synthetic, non-personal Korean contract image with:

```sh
node tests/table-validation-fixtures.cjs
node tests/create-table-browser.cjs
node --test tests/ocr-tables.test.cjs tests/table-accuracy-review.test.cjs tests/table-analysis-review.test.cjs tests/ocr-table-draft.test.cjs
```

The image generator uses Windows fonts; the geometry/test fixtures themselves are dependency-free and portable. The local browser harness is written under `work/table-qa/` and is not in deployment assets.

Known-answer coverage includes a 5-row/4-column table with a merged title, a blank cell, Korean text, dates, positive/negative amounts, broken rules, crossing line boxes, HTML/formula escaping, 70 merge/split geometries, and abort/session races. A 1,500-word/600-slot mapping case verifies no duplicate assignment.

The full automated suite passes 231 tests. Browser checks exercise both existing local OCR engines and Google Vision, source/cell selection, manual region creation, merge/undo, table copy, blocked unresolved-line exports, explicit cell retry acceptance/rejection, and retained edits when navigating a 50-record correction fixture. The latter is a navigation/persistence test, not a 50-page OCR benchmark. A synthetic Vision response also tests the full server → browser normalization → table → TSV/HTML pipeline, including split financial punctuation. A 20,000-symbol case covers the bounded punctuation path.

Measured on the development PC on 2026-09-14:

- Browser, 1200×1500 synthetic contract: one complete 17-cell table, zero unassigned words; structure worker plus raster preparation/startup about 90 ms in the initial run.
- Native Node, same image geometry: roughly 38–59 ms across five runs, excluding image preparation, OCR, and UI.
- Actual PP-OCRv5 browser OCR of the synthetic image: 18 lines, approximately 4.12 seconds including engine preparation in this run. This is a small clean fixture, not a dense multi-page contract benchmark.
- Actual Google Vision on the deployed Studio recognized 38 word regions from the same synthetic image. Table correction produced 17 cells, preserving `1,250,000`, `2,500,000`, `-50,000`, `2026-09-14`, the merged title, and the empty cell. Source selection, amount correction, clipboard success, apply/reopen persistence, and unchanged original OCR text were checked. That response kept each amount in one word; the split-punctuation failure was reproduced separately with synthetic geometry and is covered by regression tests. No Vision latency or concurrent-throughput benchmark is claimed.

These are single-host engineering measurements. Accuracy across an office's actual document collection, low-memory mobile devices, live Excel paste, and a 200-user rollout must be evaluated separately; do not describe them as already certified or load-tested.
