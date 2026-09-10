---
category: Fixed
audience: internal
---

**Two defects found by reviewing the provisioning work against a fresh firm that still could not upload.**

**The runbook told the operator to create the R2 S3 token scoped to the platform bucket.** That
instruction is from 2026-06-22; per-firm buckets began being signed with "the same account-scoped
credential" on 2026-09-03, and nobody reconciled the two. A key scoped to one bucket cannot sign a
valid request for any other, so a token made to the runbook's instruction refuses every per-firm
presigned PUT with 403 — after the reserve has succeeded, which is exactly the shape the owner has
been seeing. The row now says "Apply to all buckets in this account", and says why.

**The reset script treated a bucket that was never created as a failure to delete**, which would have
blocked the whole reset behind every firm provisioned under the dev adapter (which records a bucket
name and creates nothing). A 404 on the listing now counts as already gone.
