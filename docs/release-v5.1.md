# PDF Studio v5.1

Review stamps now capture target page IDs when placed; changing pages finishes a review placement. Selecting another preset adds a separate stamp. “하나 더 찍기” duplicates the current placement with an offset. A 44px corner hit target resizes the image and its text proportionately; arrow keys provide a keyboard alternative. Enter or Escape finishes placement without deleting it or closing the preview. Arrow geometry uses two smooth spring coils, shared by the SVG overlay, PNG export and PDF output.

Basic previously read the imported source while Pro effects existed only in the Pro pipeline. Switching back now prepares the Pro output and all thumbnails before publishing a new Basic source. Failures and cancellation keep the Pro document intact. Applied options are cleared to avoid applying stamps, watermarks, page numbering and scan corrections twice. The transfer is one undoable edit; Undo restores the source pages, editable stamp metadata, Pro controls and accepted OCR records, and Redo restores the transferred document.

The transfer commits existing overlays into PDF content. Original PDF text remains searchable, but to edit the previous overlay objects or Pro settings individually, undo the transfer. New Basic edits remain available normally. Transferring a large scanned document can take time; the existing progress/cancel UI covers processing and thumbnail generation. No cloud service is used for this transfer.

Validation: 309 Node tests passed, including PDF arrow raster parity across four rotations, offset CropBoxes and two UserUnit values. `tests/create-review-workflow.cjs` generates browser fixtures for web and `--standalone`. The seven scenarios exercise six separate stamps on page 2, navigation, proportional resizing, Enter/Escape, PDF page targeting, injected transfer failure, Basic export, undo/redo and repeated mode switches. The standalone fixture serves the actual bundled HTML over localhost; it does not establish compatibility with every browser's `file:` security policy. The v5.0 standalone OCR worker fix is retained.

## v5.1.1

Opening an existing stamp for editing now navigates to its captured page before activating the handles. This prevents the page-change completion shortcut from ending a just-opened edit. An eighth browser scenario covers editing page 2 from page 3 and verifies that the stamp count remains unchanged. Future fixes increment the patch version; feature releases increment the minor version.
