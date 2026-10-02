---
number: 457
slug: bytes-belong-to-every-file-that-names-them
status: Accepted
date: 2026-09-11
area: Documents
summary: "A file whose SHA-256 the firm already holds is never uploaded again, and there is no setting that says otherwise: the browser hashes every chosen file, the firm is asked, and a match is made from the held bytes server-side. Because one set of bytes can then stand behind several files, the bytes belong to every file_version row that names them, live or soft-deleted, and deleting one file never destroys them. Destruction has one door — purgeableVersionObjects in @magna-carta/file-manager — which refuses an object while any other version row holds the same content hash or the same object key, and it is called by no route and no sweep today: default retention is indefinite, and the retention policy engine, when built, walks it per file and destroys exactly what it names. The reference check counts by content hash as well as by key so it holds whether held bytes are copied under a new key, as they are today, or shared under one later."
---

**Bytes the firm holds belong to every file that names them, so deleting one file never deletes
them, and the one door to destroying them counts the other holders first.**

**Context:** The Upload panel carried a setting, "Files the Firm Already Holds", offering to send a
file again even though the firm had those bytes. The owner ruled it out on 2026-09-09: one
behaviour, and it is the default. That closes a question the storage side had left open. A file the
firm holds is made from the held bytes rather than sent, so one set of bytes can stand behind
several files on several matters; the soft-delete destroys only the transient working copy and
retains committed versions indefinitely; but nothing said, in code, what a future destruction step
may take when two files share content and one of them is deleted.

**Decision:** as the summary states. The rules worth holding to:

- The hash is always read, from the moment a file is chosen, and the firm is always asked. The
  readiness the panel shows per file (reading, ready, held, not read) is that read and that answer.
- A reference is a `file_version` row, whatever its file's state. A soft-deleted file is
  recoverable, and a recovered file with no bytes behind it is not a recovery, so its rows keep
  every object they name alive until a retention policy removes the rows themselves.
- `purgeableVersionObjects` is the only place that decides which of a deleted file's objects may be
  destroyed. A destruction sweep destroys what it names and computes no list of its own; the
  reference count is the whole safety of the operation and lives once.
- The DELETE route stays a soft delete. The working copy remains the one object a delete may take,
  because it is keyed to the file alone and re-materializes from the committed version.

**Considered and rejected:** **Keeping the setting** as an escape for a reader who wants a second
copy sent anyway; a second copy of held bytes is a second row over the same content, which the
server-side duplicate already makes without the transfer. **Sharing one object key per hash now**,
so that the bytes are stored once; an object's matter is stamped in its metadata and a key shared
across matters would carry one matter's scope for another's file, so the copy stays and the guard
counts by hash so a later economy does not have to re-decide the rule. **Wiring the guard into the
delete route** as a hard delete of unshared objects; the deleted-files retention design forbids any
purge gesture in the file manager, and a delete that destroyed bytes when no other file held them
would make "stays recoverable" false for exactly the files nobody else had.
