---
category: Added
audience: public
---

**Insert pages from another PDF in the PDF Editor.** The Pages tool gains **Insert Pages**
(`apps/web/src/lib/pdf-editor/insert-pages-dialog.svelte`): pick one of the matter's PDFs (the
shared `MatterDocumentPicker`, which gains an optional `accepts` filter and an optional
`chosenNoun`) or a PDF from the computer, and put its pages before or after a page or at the end.
The pages join the arrangement numbered past the original's last page (`insertPages`,
`insertionIndex`, `wasInserted` in `page-arrangement.ts`), and `arrangeDocument` joins each
inserted file onto the end of the original with the engine's existing merge before it turns, cuts
and joins, so no new engine operation was needed. Save files a new version as before; Reset takes
the inserted pages out. Tested in `apps/web/test/pdf-editor-page-arrangement.test.ts` and, against
the real engine, `apps/web/test/pdf-editor-arrange-document.test.ts`.

## Public

In the PDF Editor's Pages tool, **Insert Pages** adds the pages of another PDF, from the matter or
from your computer, before or after any page or at the end, and saves the result as a new version.
