---
category: Added
audience: public
---

**A copy that leaves the platform has every tracked change accepted; the stored document keeps them.** A `.docx` version the browser editor cuts owes an export copy from the moment it exists (`export_copy_state`, `export_r2_key`, `export_size_bytes` on `file_version`, marked `pending` in the batch that cuts the version), and the copy is made off the request path: the save asks the shared per-firm queue directly (`file.export_copy_requested`), and the relay's publication of `file.version_committed` reaches the same idempotent handler as the backstop. `acceptTrackedChanges` in `@magna-carta/document-assembly` (`./ooxml-accept-tracked-changes`) is the pass — an XML rewrite over the revision elements of WordprocessingML, never a re-render: insertions keep their content, deletions go, a deleted paragraph mark joins its paragraph to the next keeping the following mark as Word does, deleted rows and cells go, property-change records and range markers go. A part with nothing recorded is left byte-for-byte; a version that recorded nothing is `ready` at its own key.

Every download lane is served from the copy through one resolver (`apps/api-worker/src/exports/export-object.ts`): the per-file redirect, and every lane of the bulk download with the entries' keys swapped once before the lanes branch. A copy still pending at the moment of a download is made on the spot; a bulk selection with more than three pending answers 409 `export-copies-pending`. A document past the pass's caps is recorded `unavailable` and downloads as stored, with the audit row saying so (`exportCopy` on the per-file audit, `acceptedCopies`/`unavailableCopies` on the bulk one). The enumeration of outbound paths, what is deliberately not one, and what must join the list when built, is in `apps/api-worker/src/editing/CLAUDE.md`. `readPackage` takes its caps as a parameter, with the template caps as the default; `export-copy` joins the matter-scoped object classes; the purge list carries the copy beside the version's object.

## Public

**What you send out shows the finished text, not the edits.** A document edited in the browser keeps a record of who changed what, and that record stays in the document for as long as it lives. A copy that leaves the platform does not carry it: downloading the document, or a bundle that holds it, hands out a copy with every change accepted, so the other side sees the text and nobody's redlines.

The copy is made moments after each save. Download in that same moment and the download waits for it; a bundle of several documents saved that instant may ask you to try again shortly. A document too large for the copy to be made downloads as stored, and the firm's audit trail records that it did.
