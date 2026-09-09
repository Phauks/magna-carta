---
category: Changed
audience: public
---

**The Upload panel, after the owner's 2026-09-08 round, plus the diagnosis behind it.**

The Add menu becomes one press (files; the folder ask rides a chevron on the same control, because
no engine offers a picker taking both). Where the File System Access pickers exist they replace the
hidden `<input>`s, so choosing a folder no longer makes Chrome raise its own "Upload N files to this
site?" over the panel. The batch-wide document type is gone: it is a column on the source table set
on the selected rows, so `UploadBatchPlan` carries `documentTypeIds` keyed by intake key rather than
one id. "On Arrival" is a folded **Advanced Settings** accordion holding the dating basis and a new
`checkDuplicates` setting. `DataTable.ClearFilters` joins the panel's control row, which is the one
table companion the source table lacked.

Hashing moves out of the upload lane into a new register, `upload-digests.svelte.ts`: reads start
when a file is CHOSEN, run one behind another (there is one worker), are memoized per intake key,
and report to a caller that arrives mid-read from wherever the read has got to.
`UploadQueueDependencies.hash(file, …)` is therefore replaced by `digest(entry, …)` — the seam any
stand-in for the queue's network implements. The pace line beside the progress bar takes a fixed
measure from the new `size.transfer-pace` token, so a changing byte count no longer resizes the bar.

The failed upload in the owner's log was the CORS signature from §15 of the operations runbook — a
201 reservation, no part calls, an abort seven to nine seconds later (the retry ladder), and no
Worker-side error at all, because the refusal happens between the browser and the bucket. That
signature is now written into the runbook, and a transport failure on the byte write says the
storage did not answer rather than the flat "nothing answered" that sent readers to check their own
connection.

## Public

**Uploading asks one question fewer, and starts working before you press Upload.**

**Add is one press.** It used to open a menu before it did anything; now it opens the file picker.
Folders are still their own ask — no browser will put files and folders in one picker — but the
arrow beside Add reaches it, and dragging any mix of files and folders onto the panel needs neither.

**A folder no longer makes the browser ask a second time.** Choosing a folder used to raise Chrome's
own "Upload N files to this site?" over the top of the panel, about a choice you had just made.

**A document type is set per file, not per batch.** One type for a whole upload is wrong about every
real folder — discovery holds correspondence, pleadings and exhibits together. Select rows, set the
type, and one upload files as many kinds as it needs to.

**"On Arrival" is now Advanced Settings, and it is folded shut.** Inside it: how a file is dated, and
whether the firm is asked if it already holds the bytes.

**Files are read while they wait their turn.** Each file is read so the firm can say "we already hold
this" before a byte moves, and that read now starts the moment you choose the file rather than when
the transfer reaches it. On a large batch most of the answers are in before you press Upload.

**The progress bar holds still.** The line beside it says how much has gone, how fast, and how long
is left, and every one of those figures changes length as the transfer runs — which resized the bar
several times a second. Its room is reserved now, filled or not.

**An upload that cannot reach storage says so.** Files go from your browser straight to your firm's
storage rather than through the rest of the application, so a refusal there reads as silence. It
said "nothing answered", which sent people to look at their own connection; it now says that it is
the storage that did not answer, that nothing was saved, and who puts it right.
