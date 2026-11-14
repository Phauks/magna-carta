---
category: Added
audience: public
---

**The File Workbench Convert tab converts.** `conversion-run.ts` runs one conversion through the server's routes: an upload slot, a direct PUT to storage, the submit naming both formats, then the job state polled every 1.5 seconds until it is done, failed or expired, and the signed result read into a Blob. `panels/convert-panel.svelte` runs it over the selection in turn and lists each file's result, with save, Put on the Bench, and Put All on the Bench. The capability is served.

## Public

**Convert files on the File Workbench.** Select one file or many, open **Convert** and press a format. Each file is converted in turn, and every copy can be saved or put on the bench beside the original. The originals are never changed.
