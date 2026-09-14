# Page-specific scan angle correction

Pro → 페이지 규격 enables automatic deskew by default. A page may override it
with a clockwise-positive angle from −60° to +60°, in 0.1° steps. Manual 0°
retains the source orientation and skips automatic analysis. “자동으로” removes
only that page's override. Page UIDs keep overrides stable through reordering;
document undo/redo restores them.

The preview toolbar opens a rotation handle and a horizontal drag strip. Opening
the controls does not change the document. Mouse/touch movement draws a bounded
canvas preview; release commits one history entry and schedules PDF processing.
Pointer cancellation, lost capture, Escape, and changing pages discard an active
gesture. Arrow keys adjust 0.1°, Shift+Arrow adjusts 1°, and Home sets 0°.
Only these handles prevent touch scrolling. Phone layouts use 44/48px targets.

## Content preservation

Rotation expands the page boxes instead of shrinking the content. The original
visible CropBox/MediaBox intersection remains clipped, so previously hidden
content is not exposed. Vectors, searchable text, /Rotate and /UserUnit remain
intact. A4 fitting remains available; explicitly enabled margin cropping still
crops the selected margins. Pages with PDF links, annotations or form widgets
retain their orientation in automatic mode; nonzero manual changes report why
they cannot be applied rather than misplacing interactive content.

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

- 273 automated tests passed, no skips in the development environment.
- Actual PDF.js rendering: 32 combinations of ±3°/±60°, four /Rotate values,
  original size/A4, with all four corner markers retained and cropped-out
  content still hidden. The regression test fails with the previous rectangle
  clipping operation.
- Poppler output checks include offset page boxes, UserUnit=2, retained original
  text/OCR, added searchable text and page numbering through the full pipeline.
- Browser UI: per-page angles, both drag controls, range validation, Ctrl+Z,
  Basic/Pro switching, result generation and an error-free fresh document.
- 390×844 layout and pointer drag checked; touch cancellation is covered by a
  pointer-event harness. Physical Android/iOS touch hardware was not exercised.

The same UI and processing code is included in the standalone HTML build.
