---
category: Fixed
audience: internal
---

**Uploading a document from the file manager filed it at the matter root, whichever folder the
reader was standing in.** The screen shows one folder at a time, so the file simply was not there
afterwards — indistinguishable from an upload that failed.

`POST /api/v1/uploads` has always accepted `folderId` and `documentTypeId`. The document loop's client
type does not declare either, so neither was ever sent. Two smaller contributors sat on top of it:
the upload never asked where the file should go, and the surface never navigated to the destination
once the file landed.

The file manager now runs its own destination-aware reservation, reusing the shared put, complete and
status calls and re-declaring only the reservation itself, sending `null` explicitly rather than
omitting a field. **The test asserts the reservation body rather than that the ceremony completed** —
a test of the second kind would have passed for the entire life of the defect.

Alongside it, the file manager is ported from the owner's own surface: one table carrying the same
column machinery as every other ledger, a computed right-click model rather than a template of
conditions, a five-tab details panel whose hashes genuinely recompute against the integrity endpoint,
and the folder rail finally wired to the tree component that was built for it and never connected.
