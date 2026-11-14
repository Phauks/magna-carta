---
category: Added
audience: public
---

**The PDF Editor's Watermark tab.** Words (a preset or the reader's own, in a standard typeface, size and one of three colours) or a PNG or JPEG image, with strength, angle, once or repeated, and an optional page list such as `1-3, 7`, previewed on the first marked page. `watermarkDocument` runs in the operations worker and the copy is filed beside the original. The settings and the page list are checked before the engine is asked (`apps/web/src/lib/pdf-editor/watermark.ts`), and the options are tested against the real engine (`apps/web/test/pdf-editor-watermark.test.ts`).

## Public

**Watermark a PDF.** In the PDF Editor's Watermark tab, print a word such as CONFIDENTIAL or the firm's logo across all of a document's pages or only the ones you choose, and see it on a page before you commit. The marked copy is saved beside the original.
