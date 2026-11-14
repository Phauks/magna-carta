---
category: Added
audience: public
---

**Convert on a matter file's right-click menu.** `file-menu-model.ts` builds the Convert flyout from the conversion graph (`conversionChoicesFor`), with targets read as extensions and the variant beside a shared extension named in parentheses; it is disabled with a reason for a file with no committed version or no target. `file-manager.svelte` reads the file, runs the shared `conversion-run.ts`, and files the copy into the original's folder through `startUploadBatch` with keep-both on a name clash. The availability register marks convert as served.

## Public

**Convert a document from its right-click menu.** Right-click a file in a matter and open **Convert** to turn it into a PDF, a text file or another format it can become. The converted copy is filed beside the original, and the original is never changed.
