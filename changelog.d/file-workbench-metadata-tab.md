---
category: Added
audience: public
---

**The File Workbench's Metadata tab is served.** `apps/web/src/lib/tools/file-workbench/panels/metadata-panel.svelte` runs `@magna-carta/metadata` in the browser on DOCX, JPEG and PNG. The findings are drawn as one table per scrub switch (`metadata-reading.ts` maps the engine's categories to the six `ScrubOptions`), so each box stands for exactly one thing the scrub can honour. The clean copy is saved or put on the bench, and the engine's re-inspection of the output is checked against the ticked switches. The table of supported formats in the user guide now matches what the engine reads.

## Public

**See what a document or photo is hiding, and send a clean copy.** Open a Word document, JPEG or PNG on the File Workbench's **Metadata** tab to see its tracked changes, comments, hidden text, author and editing details, attached data and a photo's camera and location details, each in its own table. Untick anything you want to keep, then save a clean copy or put it on the workbench to check first. The copy is read again as soon as it is made, and the original is never changed. Everything happens in your browser.
