# Local table recognition and correction

The existing OCR providers are unchanged. In Pro → Text recognition → Advanced → Correct recognition results, the **Table** view analyzes the current page and reuses the OCR word/line coordinates. The same correction view is built into the OCR lab and both standalone HTML builds.

## Accuracy contract

- Detect bordered grids, including mildly curved or slanted photographed rules, and preserve empty cells. Join only nearby, continuous rule fragments; separate adjacent sections with different column layouts. Infer a merged cell only when missing interior borders describe a rectangle. Decorative document frames and signature areas do not become a table merely because they contain text.
- Display traced rule segments over the source, including gaps at merged headers. The editable row/column model remains a rectangular approximation; a curved-border notice requests comparison with the original. This does not promise perspective rectification or arbitrary borderless-table recognition.
- Flag empty OCR cells when raster evidence suggests visible writing or a mark inside them, excluding grid borders and tiny dust. This can also indicate a stamp or signature, so it requests original comparison instead of inventing text. Keep the warning across reopening until the cell is corrected.
- Keep the original image, OCR text, and OCR geometry unchanged by table edits. Table text and topology are separate `record.tables` data used by table copy/TSV/JSON export. Searchable-PDF text correction remains in the line view.
- Assign words by overlap with cells. A PP-OCRv5 line spanning multiple cells is never divided by character count or guessed spaces. Its full original text remains visible until the user explicitly confirms it was reflected in the appropriate cells. Changing affected cell text or geometry invalidates that confirmation.
- Preserve small punctuation inside its text row. Vision can provide a comma, decimal point, currency sign, or date hyphen as a separate short ink box. Attach these to nearby full-height source words before ordering the row, so a value such as `1,250,000` does not become `1250000` followed by commas on another line. Preserve the original text, separators, and coordinates; do not infer missing digits.
- Preserve edited cell text during boundary movement and flag changed OCR membership. Merging and splitting must cover every grid slot exactly once. Splitting corrected text requires restoring its OCR text first; do not guess how to divide a corrected number or phrase.
- Drag internal separators or outer boundaries on the original; use arrow keys for fine movement. Row/column insertion adds a separator within the selected source interval. Existing merged or corrected content stays whole until explicitly split. Row/column deletion removes extracted cell values, excludes their original OCR indices from future remapping, and retains the original page and OCR record. A merged heading crossing a removed band keeps its text and requests review.
- Require original comparison before table export. Manual boundaries and uncertain/merged cells remain reviewable. A checked review box represents a user's review, not an accuracy guarantee.
- Refuse oversized/ambiguous geometry with an actionable message. Text-only layouts and heavily skewed or fragmented rules require page correction or manual region/row/column setup. A complete semantic model for all borderless layouts is not provided.
- Clipboard HTML preserves row/column spans; TSV stores merged text at the top-left slot. Spreadsheet formula starters are neutralized, numeric negative amounts are retained, and HTML requests text cell formatting. For TSV imports, select text columns to avoid spreadsheet conversion of account numbers, leading zeros, or long identifiers. Live Excel interoperability still needs target-office validation.

## Browser resource policy

- Table undo survives cell typing and page navigation within the open dialog. It retains up to 20 snapshots across pages, bounded by four million serialized UTF-16 characters. This bounds retained history, not total browser memory. Closing the dialog releases history.
- Table structure has no external API call, GPU requirement, model download, or new dependency. A disposable Blob worker runs the bounded image/geometry analysis.
- Entering Table view automatically analyzes the current page once if it has no tables. The user can also draw a smaller region for tracing. Raster long edge is at most 1600 pixels; transfer its RGBA buffer once to the worker. The maximum raster buffer alone is 10.24 MB (an A4-like page is smaller); this is **not** a claim about total application memory.
- Bound work to 600 primitive grid slots, 12 tables per page, 80 boundaries per table, and 20,000 OCR regions per page. Raster rule/crossing candidate counts are also bounded. Limits produce messages, not silent truncation.
- A 10-second structure deadline, cancellation, page/view changes, and dialog close terminate work. Release temporary images and original preview copies promptly. Table results retain text/coordinates, not extra full-page images.
- Optional cell OCR uses a lazily created local session reused within the correction dialog, with a 90-second deadline. Closing/canceling rejects late results and releases the session. PP-OCRv5 pages use PP-OCRv5; other pages use local Tesseract. Google Vision is never called implicitly for cell retries.
- Cell OCR returns a proposal beside the existing value. The user must accept it before any cell text changes; empty results leave the old text intact. In the real fixture test, PP-OCRv5 cell retry omitted the first digit of `1,250,000`, which is why retries must not automatically replace an already correct amount.
- Region OCR can use a freely drawn source crop. The UI names the selected destination cell and compares the existing/candidate text before acceptance. Even a crop spanning several cells is never silently distributed across them. The crop mode is independent of table-boundary editing.
- This distributes additional structure work across staff devices. It does not establish 200-user concurrent capacity or remove existing lab page limits. Google Vision requests continue to use the existing cloud quota/rate-limit configuration.

## Validation

Generate the synthetic, non-personal Korean contract image with:

```sh
node tests/table-validation-fixtures.cjs
node tests/create-table-browser.cjs
node --test tests/ocr-tables.test.cjs tests/table-accuracy-review.test.cjs tests/table-analysis-review.test.cjs tests/ocr-table-draft.test.cjs
node --test tests/ocr-table-photo-geometry.test.cjs tests/ocr-table-edit.test.cjs
```

The image generator uses Windows fonts; the geometry/test fixtures themselves are dependency-free and portable. The local browser harness is written under `work/table-qa/` and is not in deployment assets.

An optional local-photo check decodes an image and prints structural counts without adding it to deployment assets:

```sh
node tests/verify-local-table-photo.cjs '<local-image-path>' '5x4:20,13x7:79'
```

The user's private photograph, OCR text, and signatures are not committed. Procedural geometry regressions cover the corresponding curved rules and merged headers without reproducing personal data.

Known-answer coverage includes a 5-row/4-column table with a merged title, a blank cell, Korean text, dates, positive/negative amounts, broken rules, crossing line boxes, HTML/formula escaping, 70 merge/split geometries, and abort/session races. A 1,500-word/600-slot mapping case verifies no duplicate assignment.

The current automated suite passes **249 tests**. New browser checks cover deletion of a manually corrected amount, typing in another cell, page navigation, and two successive undos restoring both values. A click inside a wide boundary handle preserves its coordinate and review state; dragging, keyboard fine adjustment, merge/split, row/column edits, clipboard TSV, and HTML merged headers were checked. The desktop table viewport increased from 125 to 251 pixels at 1280×720 in the synthetic fixture by collapsing review details and compacting controls; actual space varies with the document and viewport.

Browser checks exercise both existing local OCR engines and Google Vision, source/cell selection, manual region creation, merge/undo, table copy, blocked unresolved-line exports, explicit cell retry acceptance/rejection, and retained edits when navigating a 50-record correction fixture. The latter is a navigation/persistence test, not a 50-page OCR benchmark. A synthetic Vision response also tests the full server → browser normalization → table → TSV/HTML pipeline, including split financial punctuation. A 20,000-symbol case covers the bounded punctuation path.

Measured on the development PC on 2026-09-14:

- Browser, 1200×1500 synthetic contract: one complete 17-cell table, zero unassigned words; structure worker plus raster preparation/startup about 90 ms in the initial run.
- Native Node, same image geometry: roughly 38–59 ms across five runs, excluding image preparation, OCR, and UI.
- Actual PP-OCRv5 browser OCR of the synthetic image: 18 lines, approximately 4.12 seconds including engine preparation in this run. This is a small clean fixture, not a dense multi-page contract benchmark.
- Actual Google Vision on the deployed Studio recognized 38 word regions from the same synthetic image. Table correction produced 17 cells, preserving `1,250,000`, `2,500,000`, `-50,000`, `2026-09-14`, the merged title, and the empty cell. Source selection, amount correction, clipboard success, apply/reopen persistence, and unchanged original OCR text were checked. That response kept each amount in one word; the split-punctuation failure was reproduced separately with synthetic geometry and is covered by regression tests. No Vision latency or concurrent-throughput benchmark is claimed.
- Actual photographed construction-cost statement, original 898×1280 pixels: upper 5×4 grid with 20 cells and lower 13×7 grid with 79 cells, including the full-width title and two-row merged header. Native Node structure analysis took 28–55 ms across five runs, excluding decoding, OCR and UI. This image was tested locally, not sent to Google Vision.
- The same 20+79-cell structure was verified in both final Studio and OCR-lab browser builds. A double-resampling regression reproduces Studio's image-to-PDF path: a bold text stroke previously split the last merged header into an 80th cell. Removing that text-like rule candidate while retaining rules joined to vertical separators restores the header. Thirty-six 1600px resampling combinations preserve the structure; substantially smaller/recompressed photographs are not guaranteed.
- Actual local PP-OCRv5 on that photograph produced 131 text lines. All six numeric total cells matched the source in this run, but several other amounts and labels did not. A freely drawn crop corrected `1,546,123.031` to `1,546,123,031`; explicit acceptance and apply/reopen preserved the correction. This is evidence for the correction workflow, not a claim of complete OCR accuracy.
- OCR-lab recognition of this one-page photograph completed in 12.19 seconds including engine preparation in the displayed run. Final browser checks also confirmed undoing an accepted region-recognition proposal. No mobile or 200-client performance result is inferred from this single desktop run.

Interaction references: [FineReader table analysis](https://help.abbyy.com/en-us/finereader/16/user_guide/tableanalysis/), [FineReader area editing](https://help.abbyy.com/en-us/finereader/16/user_guide/editareas/), and [Acrobat OCR text comparison](https://helpx.adobe.com/acrobat/desktop/create-documents/scan-documents-to-pdfs/fix-scanned-text.html). These informed the source-boundary tools, contextual cell actions and explicit candidate acceptance; this implementation uses the existing local OCR providers.

These are single-host engineering measurements. Accuracy across an office's actual document collection, low-memory mobile devices, live Excel paste, and a 200-user rollout must be evaluated separately; do not describe them as already certified or load-tested.
