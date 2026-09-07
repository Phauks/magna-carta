---
category: Added
audience: internal
---

Every migration batch now leaves behind the instant before it ran.

The lineage runs only forwards, so a migration that succeeds and turns out to be wrong had no way back at all. A migration that FAILS never needed one — workerd rolls the whole context back and the database is exactly as it was, which is why a day of failed migrations damaged nothing — but the successful-and-wrong case is unrecoverable without a point to return to.

Before applying a pending batch, the firm's database takes a Cloudflare bookmark: an opaque handle naming that instant, which the platform can restore the object to. It is written beside the ledger with the timestamp and the tags the batch applied, so a reader knows which deploy it precedes rather than having to work it out. The diagnostics read carries it, which means the restore point is visible on the same panel that reports a stuck lineage.

Taking it is best-effort, and recording it never fails the migration that succeeded: a firm on the right schema with no restore point is a worse diagnostic, not a worse database. One row, replaced each batch — Cloudflare's retention window bounds how far back an object can go, and a list of bookmarks older than that window would be a list of restore points that no longer restore anything.
