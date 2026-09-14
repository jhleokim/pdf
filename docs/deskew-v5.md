# Page-specific scan angle correction

Pro → 페이지 규격 enables automatic deskew by default. A page may override it
with a clockwise-positive angle from −60° to +60°, in 0.1° steps. Manual 0°
retains the source orientation and skips automatic analysis. “자동으로” removes
only that page's override. Page UIDs keep overrides stable through reordering;
document undo/redo restores them.

The preview toolbar opens a bottom ruler with a fixed center indicator, numeric
angle input, 0.1° step buttons, Auto, Original (manual 0°) and Done. The ruler
follows the pointer at ten pixels per degree. Opening the controls does not
change the document. Mouse/touch movement draws a bounded canvas preview;
release commits one history entry and schedules PDF processing.
Pointer cancellation, lost capture, Escape, and changing pages discard an active
gesture. Arrow keys adjust 0.1°, Shift+Arrow adjusts 1°, and Home sets 0°.
Only the ruler prevents touch scrolling. Phone controls have 44px targets.
During adjustment the page fits above the separate dock, with guides confined
to the paper. Phone layouts temporarily hide the thumbnail rail to give the
document the available height. Done restores the ordinary preview and rail.
External close discards an invalid dial draft; an invalid sidebar draft still
blocks export. Both keep the last valid document angle.

## Content preservation

Rotation expands the page boxes instead of shrinking the content. The original
visible CropBox/MediaBox intersection remains clipped, so previously hidden
content is not exposed. Vectors, searchable text, /Rotate and /UserUnit remain
intact. A4 fitting remains available; explicitly enabled margin cropping still
crops the selected margins. Pages with PDF links, annotations or form widgets
retain their orientation in automatic mode; nonzero manual changes report why
they cannot be applied rather than misplacing interactive content.

“빈 모서리 자르기” is an explicit per-page opt-in, off by default. It chooses
the largest centered rectangle with the source aspect ratio entirely inside
the rotated source. The PDF transform keeps the original scale; only page boxes
are cropped. The ruler reports the excluded page-area percentage, and its drag
preview dims the excluded area. This can remove edge content and does not detect
pre-existing white margins. Zero degrees remains unchanged. Crop choices follow
page UIDs, undo/redo and OCR invalidation independently of automatic measurements.

Uncropped text verification retains the strict original-text check. For explicit
corner crops, verification transforms conservative PDF.js text-run bounds into
the retained area and checks fully enclosed runs in order. Boundary-crossing,
outside and unmeasurable runs are counted as excluded, never guessed apart.
Missing interior text still fails. When no interior text is measurable the
report says so, rather than claiming successful preservation. Additional margin
cropping, /Rotate and /UserUnit use the same geometry as the output pipeline.

The previous clipping defect was reproduced in the bundled PDF.js renderer:
its optimized rectangle (`re`) path used two transformed diagonal corners as the
clip bounds. Rotated pages therefore lost content near the other two corners,
even at 3°. The clip now uses four explicit vertices (`m/l/h`), which preserves
all corners in both PDF.js and Poppler.

## Efficiency and verification

Manual rotation does not render pages for detection. Automatic measurements
reuse a 128-entry LRU keyed by source page, orientation and annotation content;
the cache retains scalar measurements, not PDF documents or image buffers.
Drag feedback uses at most a 2048px / 4MP temporary canvas. Preview and export
share the same pipeline; per-page OCR results invalidate when that page's angle
changes.

Validation for this change:

- 303 automated tests passed, no failures or skips in the development environment.
  They cover state, gesture lifecycle, crop geometry, text validation and the
  shared preview/export pipeline.
- Actual PDF.js rendering: 32 combinations of ±3°/±60°, four /Rotate values,
  original size/A4, with all four corner markers retained and cropped-out
  content still hidden. The regression test fails with the previous rectangle
  clipping operation.
- Poppler output checks include offset page boxes, UserUnit=2, retained original
  text/OCR, added searchable text and page numbering through the full pipeline.
- Cropped PDF renders retain the source aspect ratio without exposing hidden
  content. Real-PDF verification tests include 32 rotation/angle/paper cases and
  intentionally damaged interior text, which must fail the check.
- Browser UI: per-page angles, ruler dragging, range validation, Ctrl+Z,
  Basic/Pro switching, result generation and an error-free fresh document.
- 390×844 layout and pointer drag checked; touch cancellation is covered by a
  pointer-event harness. Physical Android/iOS touch hardware was not exercised.

The same UI and processing code is included in the standalone HTML build.
