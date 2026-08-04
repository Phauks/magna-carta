---
branch: claude/fix-tenancy-shipping-uploads
worktree: cloud session (Claude Code on the web)
area: tenancy fixes — firm-scoped shipping label read + one bucket-resolution seam for presign and read
status: review
touches: apps/worker/src/files/, apps/worker/src/routes/{uploads,shipping,files,downloads,conversions,bundle-status,file-repair,dev-r2-upload}.ts, apps/worker/src/editing/checkout-routes.ts, apps/worker/src/emails/attachment-extraction.ts, apps/worker/src/scheduled.ts, apps/worker/src/app.ts, apps/worker/wrangler.jsonc, packages/data-access/src/shipment-statements.ts, apps/worker/test/, changelog.d/
---

Two tenancy defects. First: `GET /api/v1/shipments/{id}/label` read a shared R2 object keyed straight
from the URL parameter, so any authenticated member of any firm could pull another firm's label (a
recipient's postal address). The read now resolves the label row through the caller's firm-scoped
database and serves that row's recorded key; keys are firm-prefixed. Second: the upload routes
presigned against `firm.bucketName` (the per-firm bucket provisioning creates) while ingest and the
storage sweeps read the single bound `env.R2` — a silent break wherever those differ. Both ends now
resolve through one seam, `apps/worker/src/files/firm-bucket.ts`, which returns the presign name and
the read handle together and refuses a firm bucket this Worker cannot read back.

No route definitions changed, so the OpenAPI snapshot is untouched. The one config addition is the
`R2_BUCKET_NAME` var naming the bound bucket (an R2 handle carries no name); keep it byte-identical to
`r2_buckets[0].bucket_name` in `wrangler.jsonc`.
