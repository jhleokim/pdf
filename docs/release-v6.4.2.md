# v6.4.2 — Warn before leaving an active workspace

Basic and Pro now request the browser's native confirmation before refreshing, closing the tab or navigating away while a document is loaded or processing is in progress. The same handler is included in the standalone HTML. No keyboard interception, document persistence or additional network requests are introduced.

An empty workspace has no beforeunload listener. Loading and resetting documents, adding blank pages and restoring history update the listener from the existing workspace lifecycle. Downloading a PDF keeps the workspace protected because the editable session still exists in memory.

The browser controls the message and requires prior user interaction. Choosing to leave still discards the session; browser crashes and mobile app termination cannot reliably show this warning. This is a navigation warning, not automatic recovery.

Includes the v6.4.1 OCR continuity fixes: bounded Google Vision retries with a countdown, completed-page reuse and direct rendering of unedited source pages. The web release and standalone artifact use version 6.4.2; cloud OCR remains web-only.

## Validation

- Nine browser lifecycle checks passed for each of the web and standalone builds: empty workspace, pending/failed import, Basic/Pro switching, reset, undo to empty and redo.
- Actual browser navigation attempts with an active Basic or Pro document were aborted; the page and mode remained intact. This browser automation surface did not expose the native dialog for visual inspection.
- Standalone PDF download reached its normal started state without a leave-page prompt. Standalone browser QA used a local HTTP fixture; a file:// navigation warning was not separately tested.
- Four existing build checks passed, covering script parsing, matching embedded sources, unique controls and standalone dependency isolation. Both versioned builds were regenerated.
