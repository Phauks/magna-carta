---
category: Added
audience: public
---

**File Workbench PDF tab.** A PDF tab (`apps/web/src/lib/tools/file-workbench/panels/pdf-panel.svelte`) reads a bench PDF's pages and their size, its form, its password and any Bates labels on its pages, in the PDF Editor's worker (`summarize` in `apps/web/src/lib/pdf-editor/pdf-operations.worker.ts`), and lists the editor's tools with Open. Open draws the PDF Editor over the bench through shallow routing. The editor now takes a subject (`apps/web/src/lib/pdf-editor/editor-subject.ts`): a matter file as before, or a bench file whose bytes come from the browser and whose results are put back on the bench as new files, never on a matter. The tab strip and tool bodies moved into `pdf-editor-tabs.svelte`, shared by both hosts. Bates is shut on a bench file because its numbers come from a matter's register, and Signature is not offered there.

## Public

The File Workbench has a **PDF** tab. It shows a PDF's pages and their size, its form, whether it needs a password, and any Bates numbers already on its pages, and lists the PDF Editor's tools. **Open** works on the file in the same PDF Editor a matter's PDFs use, and whatever the editor makes (a redacted, watermarked or protected copy, extracted or split pages, a filled form) goes back on the workbench as a new file. Nothing is added to a matter. Bates numbering needs a matter, and the tab says so.
