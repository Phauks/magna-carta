---
category: Changed
audience: public
---

**The opening panel's stages are renamed, stamped with their own durations, and its details are the open's log rather than a second copy of the stages.** `DocumentEditorContainer` now records its phases (`requested`, `started`, `listening`, `served`, `stopped`, `error`) in its object's storage through a `fetch` override and the library's lifecycle hooks (`apps/edit-worker/src/container-phases.ts`), served at `/magna-carta/status` on the document's origin; the session object keeps every callback of an open, not only the last; and `GET …/edit-session/progress` carries both (`callbacks`, `container`), the container's record read over `EDIT_SERVICE` under a 1.5 s budget and null when the worker is unbound. `openFeed` stamps each line with its stage's own duration; `openLog` merges the three sides by instant into the rows the details show. The platform gives no sight of coolwsd's own output, so the boot shows as the gap between `started` and `listening`.

## Public

**While a document opens, the panel now says how long each stage itself took**, so the slow one is the one with the big number, and **Show details** opens a log of what actually happened, in order: the editor's container being asked for, running and answering; the editor asking for the document's details and contents and what it was told; the page loading and the document appearing. The stages have plainer names: Opening your session, Starting the editor, Loading the editor, Reading the document's details, Fetching the document, Laying out the document.
