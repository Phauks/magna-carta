---
category: Added
audience: public
---

**The matter file manager's recovery and history reads exist as routes** — `GET
/api/v1/matters/{matterId}/files/deleted` lists a matter's soft-deleted files newest-deletion-first
(the deleter resolved from the audit trail, never a fabricated actor), `POST
/api/v1/files/{id}/restore` undeletes a file into the folder it came from, a chosen folder, or the
matter root when the original folder is gone, and `GET /api/v1/matters/{matterId}/file-history`
reads the matter's file activity trail straight off the per-firm audit log with names resolved at
read time. The upload policy also gains the Windows-declared zip aliases
(`application/x-zip-compressed`, `application/x-compressed`) beside `application/zip`, so a zip
uploaded from Windows clears initiate.

## Public

**Deleted files can be seen, restored, and accounted for.** The matter's Deleted Files view now has
a real list behind it — what was deleted, when, and by whom — and Restore brings a file back where
it was (or to a folder you choose; a file whose folder is gone lands safely at the matter root).
History shows the matter's whole file trail — uploads, renames, moves, deletions, restores, and
downloads — with each entry under the file's current name. And zip files uploaded from Windows are
no longer refused.
