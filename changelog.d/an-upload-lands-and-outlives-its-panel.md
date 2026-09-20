---
category: Fixed
audience: public
---

**Every production upload failed at the storage write, and a failed upload left an empty file on the
matter.** The reservation answered two spellings of one header — `Content-Type` beside the
presigner's own `content-type` — and the browser's `Headers` merges those into a single doubled value
(`application/pdf, application/pdf`), which is not the value the signature covers, so R2 refused the
PUT with a signature mismatch. The same-origin development route never checks the signature, so the
test pool passed throughout. `routes/files/uploads.ts` and the check-in route now pass the presigner's set
through untouched, the development presigner spells the same set, `putUploadBytes` collapses any
duplicate that slips through, and a route test asserts the set through `Headers` itself. A
reservation whose bytes never land is now given back: `uploadIntoFolder` and the document loop's
client abort the session on a failed PUT or complete (and on the refused oversize case), which
abandons the pending version and drops the row that used to sit in the list with no size.

**The Upload dialog is rebuilt as intake beside source.** The left pane is the intake — the
destination matter (a searchable picker defaulting to the matter on screen, `upload-matter-picker.svelte`),
the folder, how the files are dated (the file's own date, or the upload date) and the document type
they carry; the right pane is the source — the chosen files as the product's one grid
(`DataTable.Grid`), nested the way they sit on disk with folders that fold, filterable from the
header (a filter flattens to the matching files with a Folder column, the search-results rule), and
a Status column that carries each file's stage once the transfer runs. One **Add** control offers
files or a folder; the whole pane takes a drop; several folders can be chosen at once. Nothing moves
when Upload is pressed: every control stays and is disabled, and the header line over the table
turns from the chosen count into the running tally. The grid gained an `orderRows` option and a
`gridRowComparator` export so a hierarchy sorts siblings by the grid's own rule
(`upload-intake.ts` holds the row model, tested without a browser).

**Progress is bytes, and large files upload in parts.** The storage write moved from `fetch` to
XMLHttpRequest, the one browser transport that reports upload progress (`putUploadBytes` takes
`onProgress`, an `AbortSignal`, and answers the ETag), so a sending row reads "Sending · 42%" and
the bars measure bytes. Above the firm's mode threshold (100 MB by default) `uploadIntoFolder` now
runs the multipart leg the host already tracked: fixed 16 MiB parts, three in flight, each signed
through `GET /uploads/{id}/parts/{n}`, sent, and retried on its own with backoff; the ETags go back
as the completion manifest. The single-shot PUT is retried the same way.

**A file the firm already holds is not sent, and the pace is read as it goes.** The browser hashes
each file first (`upload-hash.ts`: an incremental SHA-256 from `@noble/hashes` fed a chunk at a time
in a Web Worker, so a file of any size is read with nothing held past the chunk in hand, and the row
reads "Reading · 42%" while it goes) and asks `POST /uploads/matches` what the firm holds by digest
and size (a new index on `file_version.content_sha256` serves it). A live file on
the matter with those bytes reads Already here and nothing is sent; one elsewhere in the firm is made
into a new file on the matter through `POST /uploads/duplicates` (`duplicateVersionIntoMatter`, a
server-side bucket copy restamped for the target matter, the gate's verdict carried across). So a
folder re-sent after a failed batch sends only what did not land. A pace sampler in the queue
(`upload-pace.ts`) reads the rate and the time left over a trailing window; a stall is called only
once the whole window has seen nothing move, and a file the matter already held adds nothing to the
rate. The counts (`batchCountsText`) head the panel, the tray and the new `/uploads` page alike, and
the bytes and pace (`batchPaceText`) sit beside each bar, where a header line would cut them short.
The page lays out every batch this tab is running through the one source table component
(`upload-source-table.svelte`), which the dialog now uses too.

**A transfer outlives its panel.** Upload hands the batch to the upload queue
(`upload-queue.svelte.ts`, module state, three files at a time, one folder creation per path however
many files wait on it), the panel stays to report it and Close leaves it running, a top-bar
**upload tray** (`upload-tray.svelte`, seated ahead of the download tray) shows every batch with its
tally, a Retry Failed that resends only what failed into the same folders, and Open folder
(`/matters/{id}/files?folder=`), and the file list re-reads when a batch on its matter finishes.
Closing the tab while bytes move asks first; navigating away from the screen with files chosen and
not yet sent asks first. **Cancel Upload** stops a running batch (what landed stays, what is being
sent is given back, the rest reads Not sent and can be sent afterwards). `file_version.source_modified_at` records the device's last-modified
instant for every uploaded version, and the reservation's `createdAtBasis` dates a new file by it
when asked, clamped to now; the inspector shows it as **File's Own Date**.

## Public

**Uploading works again, and it works while you do something else.** Choose **Upload Files** and
the panel opens with the destination on the left — the matter (any matter, not only the one you are
on), the folder, whether each file keeps its own date or takes today's, and a document type for the
batch — and your files on the right, in the folders they came from. **Add** offers files or a whole
folder; you can also drop them anywhere on the right. Filter the list from its column headers.
Press **Upload** and the panel shows each file's progress; close it whenever you like, because the
upload keeps going. The **upload button in the top bar** shows what is still moving, what finished
and what failed, with **Retry Failed** and **Open folder** beside each batch. If a file does not
upload, it no longer leaves an empty entry in the matter. Each file shows how far it has got, files
of any size upload (a large one goes in pieces behind the scenes), and **Cancel Upload** stops a
batch: what has landed stays, and the rest can be sent later with **Send the Rest**. A file the
matter already holds is not sent again, and one your firm holds on another matter is copied across
without an upload; the tally reads the speed and about how long is left; and **Uploads** in the
sidebar shows every upload in full, the way Downloads does.
