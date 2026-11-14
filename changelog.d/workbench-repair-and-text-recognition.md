---
category: Added
audience: public
---

**Repair and Text Recognition tabs on the File Workbench.** `panels/repair-panel.svelte` diagnoses a file through `/api/v1/file-repair/diagnose`, then repairs or carves a copy and lists the loss manifest item by item, with each copy offered to save or to put on the bench. `panels/text-recognition-panel.svelte` sends the file to `/api/v1/ocr`, marks each page as already text, recognized or low confidence (below 0.8), shows the chosen page's text, and saves a searchable PDF through `/api/v1/ocr/searchable` or the text alone. Both call the generated client (`file-tools-api.ts`); the readings live in `file-tools-reading.ts` with a test. Both capabilities are now served.

## Public

**Repair a damaged file, and get the text out of a scan, on the File Workbench.** The **Repair** tab diagnoses a damaged file, then rebuilds a copy or pulls whole pictures and documents out of it, and lists exactly what came back and what did not. The **Text Recognition** tab reads the text of a scan page by page, flags pages worth checking, and saves a searchable PDF or the text on its own. Both run only when you ask, and the original is never changed.
