---
category: Changed
audience: public
---

**The Upload dialog holds one height, tabs its intake, states every file's readiness, names what
failed, and no longer asks whether to send files the firm already holds.** The source pane pins the
frame's height (`upload-dialog.svelte`, the record windows' own measure), so tabs, folders and rows
scroll inside it; the intake is `Tabs` — Location, Advanced Settings — in place of the accordion; Add
is one secondary button wearing the dropdown menu, with File and Folder as its items. The digest
register (`upload-digests.svelte.ts`) now asks the firm the moment a hash is in and reports each file
as reading, ready, held or not read, the batch starts every item from that readiness
(`UploadBatchPlan.readiness`), and `checkDuplicates` is gone from the plan: the hash is always read.
A failed item carries a one-line `failure` (the server's problem detail, or the transport class)
beside its full `reason`; the row and the top-bar tray both show it. On the server,
`purgeableVersionObjects` in `@magna-carta/file-manager` is the one door to destroying a version's
bytes, and it refuses while any other version row, live or soft-deleted, holds the same content or
key; the DELETE route's contract says so.

## Public

**The Upload panel keeps its size, and tells you more.** The panel opens at one height and stays
there: opening Advanced Settings, adding a folder, or unfolding one never moves what you were
looking at. The left side is two tabs, Location and Advanced Settings. Each file on the right says
whether it is ready to go: Reading while it is read, Ready once it is, Held when your firm already
has a file with exactly those bytes (nothing is sent for it), or Not read if it could not be read.
Add is one button, and its menu offers File and Folder by name. If a file fails to upload, its row
and the uploads tray say what went wrong, not only that something did. The setting that asked
whether to send files your firm already holds is gone: such a file is never sent twice, and deleting
one copy never removes the stored bytes while another file, even a deleted one, still holds them.
