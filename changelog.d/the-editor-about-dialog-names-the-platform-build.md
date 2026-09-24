---
category: Added
audience: public
---

**The editor's About dialog names the platform's build.** `apps/edit-worker/src/editor-about.ts` appends a block to `#about-dialog-info-container` as the page streams through, after the editor's own version rows: the edit worker's baked-in build identity (`@magna-carta/build-identity`), which is the deploy's commit since every Worker in one deploy reports the same one; a development build says so. The stylesheet the worker already serves gives the block its spacing.

## Public

**Help › About inside the editor now shows which Magna Carta build is serving the document**, beneath the editor's own versions: the build, when it was committed and when it was built. That is what to quote when reporting a problem from inside a document.
