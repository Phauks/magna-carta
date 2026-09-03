---
worktree: C:/dev/magna-carta-worktrees/claude/r2-bucket-isolation-review-pckokv
area: Per-firm R2 bucket isolation — the call-site sort ahead of the S3 adapter
status: review
touches: apps/api-worker/src, apps/api-worker/test, tooling/lint-firm-bucket-seam.mjs, tooling/lint-one-ui/registry.json, docs/specs/, docs/decisions/pending/, changelog.d/
---

Option A of the per-firm R2 bucket brief, complete and merged with `main`: every firm-scoped R2
access resolves through `src/files/firm-bucket.ts`; when the firm's bucket is not the bound one the
seam returns an S3-API-backed handle (`s3-firm-bucket.ts`) instead of refusing; provisioning applies
the firm bucket's expiry rules; `lint:firm-bucket-seam` holds the line. Ready for review and merge.

Owns `apps/api-worker/src/files/firm-bucket*.ts`, `s3-firm-bucket.ts`, `r2-s3-endpoint.ts`, and the
R2 call sites across downloads, conversions, emails, search, editing and preview. Also carries a
one-entry deletion in `tooling/lint-one-ui/registry.json` that `main` owed itself after #479.

Still open after this lands, named in the ADR: threading a firm's real data region to the
name-taking resolver and the presigner (every firm is `us` today), and a bucket listing to confirm
no firm holds objects in the shared bucket.
