---
category: Added
audience: public
---

**Version History says who changed what, read from the document's own marks.** `readTrackedChanges` in `@magna-carta/document-assembly` (`./ooxml-read-tracked-changes`) walks the same tree the accept pass resolves and reads every revision element as a mark: kind (insertion, deletion, formatting), the author as the document names them, the instant, the words (a paragraph break as a newline, a deleted row's words, a reformatted run's words), the part and the paragraph; one act of typing split across runs folds into one mark. The marks are read when a version's export copy is made (`apps/api-worker/src/exports/record-version-changes.ts`), the one moment the document is in hand off the request path, and the rows ride the batch that records the copy. A version records only the marks no earlier version of the file did, identified by what the document holds rather than the editor's renumbered ids; the author's name resolves to a member through the version's participants first and the firm's roster second, and a name two members share resolves to neither. `file_version_change` is keyed by version and document order, the words capped at 2000 characters and the rows at 5000 per version; the member reference is pseudonymized on erasure like the participant row.

`GET /api/v1/files/{id}/versions` rows carry `changes`, one entry per author with counts, from one grouped read per page; `GET /api/v1/files/{id}/versions/{versionId}/changes` (`files.versionChanges`) lists a version's changes in document order, bounded by construction. Version History shows the per-author summary on each row and opens a version's changes by author: additions underlined, removals struck through, formatting marked.

## Public

**Version History now says who changed what.** For a Word document edited in the browser with recording on, each version reads "Ana Vasquez: 3 added, 2 removed · Trevor Goldsmith: 1 reformatted", naming the person who typed the words rather than the person who pressed Save. Open a version's changes and the words appear in order with their author: additions underlined, removals struck through. A version lists only what is new in it. Uploaded documents, spreadsheets and presentations carry no such record.
