---
category: Added
audience: public
---

**A PDF opens and is drawn locally, by the engine the platform already had.** Opening a portable
document from the file manager now takes it to `/documents/{fileId}/view`, where its pages are
rasterized in the browser by `crates/pdf-core` compiled to WebAssembly and run in a Web Worker
(`apps/web/src/lib/documents/pdf-render.worker.ts`). The engine was built, tested and used by three
workers; nothing in the web application had ever loaded it. Only pixels leave the worker, so the
standing rule that an active format is never handed to a parser that could execute it is kept by
construction rather than by policy, and the reader needs no container, no deploy activation and no
round trip per page. Loading it in the worker is also what keeps its several megabytes off every
other screen: nothing is fetched until a document is opened. Pages are drawn as they come into
view, at a resolution that follows the zoom and is capped so a bitmap cannot outgrow the tab.

**And the text editor no longer opens what it would corrupt.** `readTextDocument` decoded with a
non-fatal `TextDecoder`, so a document in a legacy single-byte encoding, ordinary among older files
carrying curly quotes or accented names, opened with every such character replaced. Saving would
then have written that loss into a new current version. It now decodes with `fatal: true` and
refuses, offering the download instead. The shared byte read both surfaces use is now one module
(`document-bytes.ts`).

## Public

**PDFs open in the app, and text files are safer to edit.** Double-click a PDF on a matter's Files
page and it opens in a new tab, ready to read: turn pages, zoom in and out, and download it from the
same screen. Nothing is sent anywhere to make that happen, and the document is drawn by Magna
Carta's own reader rather than handed to the browser's.

Text documents also got a guard. A file written in an older character set used to open with some
characters shown wrongly, and saving it would have stored them that way. Now it says so and offers
you the download instead, so a document cannot be damaged by opening it.
