---
category: Fixed
---

**A soft-deleted file no longer accepts writes.** Every file mutation resolved its target through a
helper that did not look at `deleted_at`, so a rename, a move, a document-type assignment, a second
delete, a new upload version, and the return leg of an offline checkout all still succeeded against a
file in the recycle bin — changes nothing could see, until an undelete handed back a file that had
quietly moved or grown a version while it was gone. Mutations now resolve through `requireLiveFile`
and refuse a deleted file (`file-deleted`), which the routes answer with the same 404 every read of
that file gives, so a write is never the path that reveals it. The recovery surfaces are unchanged:
the deleted-inclusive listing still finds the file and the undelete still restores it.

**Upload ingest no longer buffers a body twice over to feed the scanner.** Within the
inspectable-size cap the pipeline tee'd the object into a hash branch and a malware-scan branch, which
couples nothing: whichever consumer read faster ran ahead and the runtime held every chunk the slower
one had not taken — a scan engine that read nothing pinned the whole body in memory with no bound of
its own. That lane now reads the body once and feeds both consumers from it, bounded by the cap that
already governs the lane and by the size R2 reported for the object. The over-cap lane is untouched
and still streams straight into the digest, so a multi-GB object never buffers.
