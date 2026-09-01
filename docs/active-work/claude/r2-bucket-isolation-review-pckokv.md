---
worktree: C:/dev/magna-carta-worktrees/claude/r2-bucket-isolation-review-pckokv
area: Per-firm R2 bucket isolation — the call-site sort ahead of the S3 adapter
status: building
touches: apps/api-worker/src, tooling/, docs/specs/, docs/decisions/pending/, changelog.d/
---

Option A of the per-firm R2 bucket brief: an S3-API-backed handle behind `resolveFirmBucket`. Step
one first — every firm-scoped R2 access now resolves through `src/files/firm-bucket.ts`, the five
call sites that resolved the bucket NAME and then read through the bound binding are fixed, and
`lint:firm-bucket-seam` holds the line with the four platform/development modules allow-listed.

Owns `apps/api-worker/src/files/firm-bucket.ts` and the R2 call sites across downloads, conversions,
emails, search, editing and preview. The adapter itself, per-firm lifecycle rules at provisioning,
and the hardcoded S3 endpoint that ignores a firm's data region are still to come.

Overlaps `claude/firm-usage-ui-surface-2zpcw6`, which is building the download register and touches
`routes/downloads.ts` and the bundle coordinator/consumer — coordinate before editing those.
