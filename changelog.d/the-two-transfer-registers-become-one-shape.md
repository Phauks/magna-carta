---
category: Changed
audience: public
---

**Uploads and Downloads are one frame rendered twice**, and the upload half now has a memory.

`$lib/transfers/` is the shared half: `transfer-tray.svelte` is the top-bar frame both registers render through — the tooltip and the popover sharing one button, the attention dot that takes the maturity dot's corner while it is raised, the titled panel, the way to the full surface — and `transfers.ts` holds the words neither is allowed its own copy of. The Upload control had never named itself on hover, which made the one control in that band that starts a transfer the one a reader could not identify; it does now, because the frame does it for both. The tables stay apart on purpose, and the module's header says why: a download is a stored document any format can be taken from, an upload is a file on a matter.

`upload-history.svelte.ts` is the new half. A transfer still dies with its tab — the files are the browser's own handles — but what a finished batch DID is a list of names, a matter, a folder and the file each one became, none of which needs a handle. That record is kept per browser (the shared persisted-preference primitive, bounded at 50 batches and 250 files each), so the Uploads screen answers "where is the thing I sent yesterday" instead of "nothing uploading", and every file that landed carries a Download straight to its own route on the matter. Nothing privileged is kept: no bytes, no digests.

Both empty states are two words now — "No Uploads", "No Downloads" — which is the standing empty-state ruling (`docs/conventions/design-corrections.md`) reaching two screens that predated it with a paragraph each about the mechanism.

## Public

**Your uploads are remembered after you close the tab.** The Uploads screen keeps a record of each batch you have sent — which matter it went to, which folder it landed in, and every file in it — and any file that landed can be downloaded again straight from there. Search reads the file names, so a file you sent last week is one query away. Hovering the upload button at the top of the screen now tells you what it is, and both transfer screens say "No Uploads" and "No Downloads" plainly when there is nothing in them.
