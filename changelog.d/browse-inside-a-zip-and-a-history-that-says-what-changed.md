---
category: Added
audience: public
---

**Browse Inside a zip, and a file history that says what changed.** Two File Manager reads. `GET
/api/v1/files/{id}/archive-entries` (`files.archiveEntries`) lists a zip's entries by reading only
its central directory from R2 — ranged reads via a hand-rolled parser in
`packages/file-manager/src/zip-central-directory.ts` (EOCD scan, ZIP64 locator/record, capped
directory walk), never the archive's body, never extraction. The container is treated as hostile:
the directory read and the entry count are capped (the firm's `fileManager.archiveCaps.maxEntries`)
with `truncated: true` instead of a throw, traversal paths are skipped, and only "not a zip at all"
errors. A soft-deleted zip browses exactly like a live one — browsing restores nothing. Second, the
file-history writes now record their from/to facts as ids in audit metadata (`file.moved` /
`file.deleted` carry folder ids, `file.document_type_assigned` its type id, uploads their folder,
`file.restored` normalized to `toFolderId`), and `files.history` resolves them server-side into
`fromText`/`toText` — current folder path text ("Home" for the root, a fixed fallback for a folder
no longer on the matter), the document type's current name, version numbers. File names never ride
audit metadata (redact-by-default), so a rename's from/to stay honest nulls, as do rows written
before the facts were recorded.

## Public

**See inside a zip without downloading it, and a file history that tells the whole story.** Click a
zip file on a matter and you can now browse what is inside it — folders, file names, sizes, and
dates — without downloading or unpacking anything. Very large archives list just as fast as small
ones, and a listing cut short by your firm's archive limits says so instead of pretending it is
complete. A zip in the Deleted Files view can be browsed the same way, so you can check what is in
it before deciding to restore. The matter's file History now also says what actually changed: a move
shows the folder it left and the folder it landed in (by their current names), a deletion shows
where the file was, a restore shows where it returned to, and a document-type change shows the type
by name. Older history entries recorded before this change simply leave those blanks empty rather
than guessing.
