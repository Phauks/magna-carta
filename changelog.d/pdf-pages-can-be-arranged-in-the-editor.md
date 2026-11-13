---
category: Added
audience: public
---

**The PDF Editor's Pages tab.** Pages are reordered (dragged through the design system's `ItemDrag`, or moved with Move Earlier and Move Later), turned and deleted on an arrangement held on the screen (`apps/web/src/lib/pdf-editor/page-arrangement.ts`), then saved as the file's next version. The worker turns pages with `rotatePages`, cuts runs of consecutive pages with `splitDocument` and joins them with `mergeDocuments` (`arrange-document.ts`), so bookmarks and form fields travel with each run. Extract to New File and Split Into Files file new documents beside the original. The model and the engine path are tested (`apps/web/test/pdf-editor-page-arrangement.test.ts`, `pdf-editor-arrange-document.test.ts`).

## Public

**Rearrange the pages of a PDF.** In the PDF Editor's Pages tab, drag pages into a new order, turn them, or delete them, then save the result as a new version of the file. The version before it stays in the file's history. You can also save some of the pages as a new file, or split a document into several files at the pages you choose.
